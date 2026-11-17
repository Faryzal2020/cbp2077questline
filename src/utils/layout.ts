import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { QuestEdgeData, QuestNodeData } from '../types';

const elk = new ELK();

export const NODE_WIDTH = 264;
export const NODE_HEIGHT = 112;

export interface FlowQuestNodeData extends Record<string, unknown> {
  quest: QuestNodeData;
  done: boolean;
  doneIconicsCount: number;
  hasChoiceBranch: boolean;
  hasChoiceRequirement: boolean;
  onToggleDone: (questId: string) => void;
}

export async function layoutQuestGraph(
  quests: QuestNodeData[],
  edges: QuestEdgeData[],
  doneQuests: Set<string>,
  doneIconics: Set<string>,
  onToggleDone: (questId: string) => void,
): Promise<{ nodes: Node<FlowQuestNodeData>[]; edges: Edge[] }> {
  const visibleIds = new Set(quests.map((q) => q.id));
  const visibleEdges = edges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  const outgoingChoiceIds = new Set<string>();
  const incomingChoiceIds = new Set<string>();
  for (const e of visibleEdges) {
    if (e.kind === 'choice') {
      outgoingChoiceIds.add(e.source);
      incomingChoiceIds.add(e.target);
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
    children: quests.map((q) => ({
      id: q.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: visibleEdges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const laidOut = await elk.layout(elkGraph);
  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const flowNodes: Node<FlowQuestNodeData>[] = quests.map((q) => {
    const pos = posMap.get(q.id) ?? { x: 0, y: 0 };
    const doneIconicsCount = q.rewards.filter((r) =>
      doneIconics.has(`${q.id}::${r.name}`),
    ).length;
    const hasChoiceBranch = outgoingChoiceIds.has(q.id);
    const hasChoiceRequirement =
      incomingChoiceIds.has(q.id) ||
      /choices?\s+in|from\s+[A-Z]+\d+/i.test(q.reqText);

    return {
      id: q.id,
      type: 'questNode',
      position: pos,
      data: {
        quest: q,
        done: doneQuests.has(q.id),
        doneIconicsCount,
        hasChoiceBranch,
        hasChoiceRequirement,
        onToggleDone,
      },
    };
  });

  const flowEdges: Edge[] = visibleEdges.map((e) => {
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
      label: e.label || undefined,
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
  });

  return { nodes: flowNodes, edges: flowEdges };
}
