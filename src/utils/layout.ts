import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { QuestEdgeData, QuestNodeData } from '../types';
import type { StubNodeData } from '../components/StubNode';

const elk = new ELK();

export const NODE_WIDTH = 264;
export const NODE_HEIGHT = 112;
export const STUB_WIDTH = 148;
export const STUB_HEIGHT = 34;

export interface FlowQuestNodeData extends Record<string, unknown> {
  quest: QuestNodeData;
  done: boolean;
  doneIconicsCount: number;
  hasChoiceBranch: boolean;
  hasExclusiveBranch: boolean;
  hasChoiceRequirement: boolean;
  incomingChoiceLabels: string[];
  isPrerequisite?: boolean;
  isSearchMatch?: boolean;
  isDimmed?: boolean;
  onToggleDone: (questId: string) => void;
}

export type AnyFlowNode = Node<FlowQuestNodeData | StubNodeData>;

export async function layoutQuestGraph(
  quests: QuestNodeData[],
  allEdges: QuestEdgeData[],
  allQuestsMap: Map<string, QuestNodeData>,
  doneQuests: Set<string>,
  doneIconics: Set<string>,
  onToggleDone: (questId: string) => void,
): Promise<{ nodes: AnyFlowNode[]; edges: Edge[] }> {
  const visibleIds = new Set(quests.map((q) => q.id));
  const visibleEdges = allEdges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  // Detect hidden incoming/outgoing edges for visible nodes due to filters
  const hiddenIn = new Map<string, string[]>();
  const hiddenOut = new Map<string, string[]>();
  for (const e of allEdges) {
    const srcVis = visibleIds.has(e.source);
    const tgtVis = visibleIds.has(e.target);
    if (!srcVis && tgtVis) {
      const list = hiddenIn.get(e.target) ?? [];
      const srcQ = allQuestsMap.get(e.source);
      list.push(srcQ ? `${srcQ.id} (${srcQ.title})` : e.source);
      hiddenIn.set(e.target, list);
    } else if (srcVis && !tgtVis) {
      const list = hiddenOut.get(e.source) ?? [];
      const tgtQ = allQuestsMap.get(e.target);
      list.push(tgtQ ? `${tgtQ.id} (${tgtQ.title})` : e.target);
      hiddenOut.set(e.source, list);
    }
  }

  const stubNodesList: { id: string; width: number; height: number; data: StubNodeData }[] = [];
  const stubEdgesList: { id: string; source: string; target: string }[] = [];

  for (const [tgtId, items] of hiddenIn.entries()) {
    const sid = `stub-in::${tgtId}`;
    stubNodesList.push({
      id: sid,
      width: STUB_WIDTH,
      height: STUB_HEIGHT,
      data: { direction: 'in', count: items.length, summary: items.join(', ') },
    });
    stubEdgesList.push({ id: `${sid}->${tgtId}`, source: sid, target: tgtId });
  }
  for (const [srcId, items] of hiddenOut.entries()) {
    const sid = `stub-out::${srcId}`;
    stubNodesList.push({
      id: sid,
      width: STUB_WIDTH,
      height: STUB_HEIGHT,
      data: { direction: 'out', count: items.length, summary: items.join(', ') },
    });
    stubEdgesList.push({ id: `${srcId}->${sid}`, source: srcId, target: sid });
  }

  const outgoingChoiceIds = new Set<string>();
  const outgoingExclusiveIds = new Set<string>();
  const incomingChoiceIds = new Set<string>();
  const incomingChoiceLabelsMap = new Map<string, string[]>();
  for (const e of visibleEdges) {
    if (e.kind === 'choice') {
      outgoingChoiceIds.add(e.source);
      if (e.exclusive) outgoingExclusiveIds.add(e.source);
      incomingChoiceIds.add(e.target);
      if (e.label && e.label !== '[!]') {
        const list = incomingChoiceLabelsMap.get(e.target) ?? [];
        if (!list.includes(e.label)) list.push(e.label);
        incomingChoiceLabelsMap.set(e.target, list);
      }
    }
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: [
      ...quests.map((q) => ({ id: q.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
      ...stubNodesList.map((s) => ({ id: s.id, width: s.width, height: s.height })),
    ],
    edges: [
      ...visibleEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      ...stubEdgesList.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    ],
  };

  const laidOut = await elk.layout(elkGraph);
  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const questFlowNodes: Node<FlowQuestNodeData>[] = quests.map((q) => {
    const pos = posMap.get(q.id) ?? { x: 0, y: 0 };
    const doneIconicsCount = q.rewards.filter((r) =>
      doneIconics.has(`${q.id}::${r.name}`),
    ).length;
    const hasChoiceBranch = outgoingChoiceIds.has(q.id);
    const hasExclusiveBranch = outgoingExclusiveIds.has(q.id);
    const hasChoiceRequirement =
      incomingChoiceIds.has(q.id) ||
      /choices?\s+in/i.test(q.reqText);
    const incomingChoiceLabels = incomingChoiceLabelsMap.get(q.id) ?? [];

    return {
      id: q.id,
      type: 'questNode',
      position: pos,
      zIndex: 10,
      data: {
        quest: q,
        done: doneQuests.has(q.id),
        doneIconicsCount,
        hasChoiceBranch,
        hasExclusiveBranch,
        hasChoiceRequirement,
        incomingChoiceLabels,
        onToggleDone,
      },
    };
  });

  const stubFlowNodes: Node<StubNodeData>[] = stubNodesList.map((s) => ({
    id: s.id,
    type: 'stubNode',
    position: posMap.get(s.id) ?? { x: 0, y: 0 },
    selectable: false,
    draggable: false,
    zIndex: 5,
    data: s.data,
  }));

  const flowEdges: Edge[] = [
    ...visibleEdges.map((e) => {
      const isChoice = e.kind === 'choice';
      const isAnd = e.kind === 'and';
      const isDuring = e.kind === 'during';

      const stroke = isChoice
        ? '#ff2a6d'
        : isAnd
          ? '#00f0ff'
          : isDuring
            ? '#a855f7'
            : '#4b5563';

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: isChoice,
        zIndex: 1,
        label: e.label || undefined,
        data: { baseStroke: stroke, isChoice, isAnd, isDuring },
        labelStyle: {
          fill: isChoice ? '#ff7aa2' : isAnd ? '#67e8f9' : '#c084fc',
          fontSize: 11,
          fontWeight: 700,
        },
        labelBgStyle: {
          fill: '#0f1219',
          fillOpacity: 0.9,
        },
        style: {
          stroke,
          strokeWidth: isChoice || isAnd ? 2.2 : 1.5,
          strokeDasharray: isChoice ? '6 4' : isDuring ? '3 3' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 16,
          height: 16,
        },
      };
    }),
    ...stubEdgesList.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      selectable: false,
      zIndex: 0,
      data: { isStub: true },
      style: {
        stroke: '#475569',
        strokeWidth: 1.3,
        strokeDasharray: '4 4',
        opacity: 0.38,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#475569',
        width: 12,
        height: 12,
      },
    })),
  ];

  return { nodes: [...questFlowNodes, ...stubFlowNodes], edges: flowEdges };
}

export function applySelectionHighlight(
  nodes: AnyFlowNode[],
  edges: Edge[],
  selectedId: string | null,
  searchMatchIds: Set<string>,
): { nodes: AnyFlowNode[]; edges: Edge[] } {
  const hasSearch = searchMatchIds.size > 0;

  if (!selectedId) {
    return {
      nodes: nodes.map((n) => {
        const isMatch = hasSearch && searchMatchIds.has(n.id);
        return {
          ...n,
          selected: false,
          zIndex: isMatch ? 25 : n.type === 'stubNode' ? 5 : 10,
          data: {
            ...n.data,
            isPrerequisite: false,
            isSearchMatch: isMatch,
            isDimmed: hasSearch && !isMatch,
          },
        };
      }),
      edges,
    };
  }

  const prereqIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  for (const e of edges) {
    if (e.target === selectedId) {
      highlightedEdgeIds.add(e.id);
      prereqIds.add(e.source);
    }
  }

  const nextNodes = nodes.map((n) => {
    const isSel = n.id === selectedId;
    const isPrereq = prereqIds.has(n.id);
    const isMatch = hasSearch && searchMatchIds.has(n.id);
    const isDimmed = !isSel && !isPrereq && !isMatch;
    return {
      ...n,
      selected: isSel,
      zIndex: isSel ? 30 : isMatch ? 25 : isPrereq ? 20 : 10,
      data: {
        ...n.data,
        isPrerequisite: isPrereq,
        isSearchMatch: isMatch,
        isDimmed,
      },
    };
  });

  const nextEdges = edges.map((e) => {
    const isHit = highlightedEdgeIds.has(e.id);
    const d = (e.data ?? {}) as { baseStroke?: string; isChoice?: boolean; isStub?: boolean };
    if (d.isStub) {
      return {
        ...e,
        zIndex: isHit ? 1000 : 0,
        style: {
          ...e.style,
          opacity: isHit ? 0.85 : 0.18,
          stroke: isHit ? '#00f0ff' : '#475569',
          strokeWidth: isHit ? 2.2 : 1.3,
        },
      };
    }

    if (isHit) {
      const hiColor = d.isChoice ? '#ff2a6d' : '#00f0ff';
      return {
        ...e,
        zIndex: 1000,
        animated: true,
        style: {
          ...e.style,
          stroke: hiColor,
          strokeWidth: 3.2,
          opacity: 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: hiColor,
          width: 18,
          height: 18,
        },
      };
    }

    return {
      ...e,
      zIndex: 1,
      style: {
        ...e.style,
        opacity: 0.22,
      },
    };
  });

  return { nodes: nextNodes, edges: nextEdges };
}
