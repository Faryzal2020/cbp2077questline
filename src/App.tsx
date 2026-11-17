import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Search, RotateCcw, CheckCircle2, Trophy } from 'lucide-react';
import { QuestNode } from './components/QuestNode';
import { StubNode } from './components/StubNode';
import { QuestDrawer } from './components/QuestDrawer';
import type { QuestGraphPayload, QuestNodeData, QuestType } from './types';
import {
  applySelectionHighlight,
  layoutQuestGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type AnyFlowNode,
  type FlowQuestNodeData,
} from './utils/layout';
import {
  iconicKey,
  loadDoneIconics,
  loadDoneQuests,
  loadFilters,
  loadViewport,
  saveDoneIconics,
  saveDoneQuests,
  saveFilters,
  saveViewport,
} from './utils/storage';

const nodeTypes = { questNode: QuestNode, stubNode: StubNode };

interface CategoryGroup {
  key: string;
  label: string;
  types: QuestType[];
  defaultOn: boolean;
}

const CATEGORIES: CategoryGroup[] = [
  { key: 'main', label: 'Main', types: ['M', 'MI'], defaultOn: true },
  { key: 'pl', label: 'Phantom Liberty', types: ['PL'], defaultOn: true },
  { key: 'endings', label: 'Endings', types: ['E', 'PLE'], defaultOn: true },
  { key: 'side', label: 'Side', types: ['S', 'SI'], defaultOn: true },
  { key: 'gigs', label: 'Gigs', types: ['G'], defaultOn: false },
  { key: 'cp', label: 'Cyberpsychos', types: ['CP'], defaultOn: false },
  { key: 'tarot', label: 'Tarot', types: ['T'], defaultOn: false },
  { key: 'ic', label: 'Dogtown IC', types: ['IC'], defaultOn: false },
];

const DEFAULT_CAT_KEYS = CATEGORIES.filter((c) => c.defaultOn).map((c) => c.key);

function QuestGraphApp() {
  const [initialFilters] = useState(() => loadFilters(DEFAULT_CAT_KEYS));
  const [savedViewport] = useState(() => loadViewport());

  const [payload, setPayload] = useState<QuestGraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCats, setActiveCats] = useState<Set<string>>(() => new Set(initialFilters.activeCats));
  const [search, setSearch] = useState(initialFilters.search);
  const [onlyWithIconics, setOnlyWithIconics] = useState(initialFilters.onlyWithIconics);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [doneQuests, setDoneQuests] = useState<Set<string>>(() => loadDoneQuests());
  const [doneIconics, setDoneIconics] = useState<Set<string>>(() => loadDoneIconics());

  const [baseNodes, setBaseNodes] = useState<AnyFlowNode[]>([]);
  const [baseEdges, setBaseEdges] = useState<Edge[]>([]);
  const [layouting, setLayouting] = useState(false);

  const { setCenter, fitView } = useReactFlow();

  useEffect(() => {
    saveFilters({
      activeCats: [...activeCats],
      onlyWithIconics,
      search,
    });
  }, [activeCats, onlyWithIconics, search]);

  useEffect(() => {
    fetch('./data/quest_graph.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: QuestGraphPayload) => setPayload(data))
      .catch((err) => setError(String(err)));
  }, []);

  const toggleQuestDone = useCallback((questId: string) => {
    setDoneQuests((prev) => {
      const next = new Set(prev);
      if (next.has(questId)) next.delete(questId);
      else next.add(questId);
      saveDoneQuests(next);
      return next;
    });
  }, []);

  const toggleIconicDone = useCallback((questId: string, rewardName: string) => {
    const k = iconicKey(questId, rewardName);
    setDoneIconics((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      saveDoneIconics(next);
      return next;
    });
  }, []);

  const handleResetProgress = useCallback(() => {
    if (!window.confirm('Clear all locally saved quest & iconic checkmarks?')) return;
    const emptyQ = new Set<string>();
    const emptyI = new Set<string>();
    setDoneQuests(emptyQ);
    setDoneIconics(emptyI);
    saveDoneQuests(emptyQ);
    saveDoneIconics(emptyI);
  }, []);

  const allQuestsMap = useMemo(() => {
    const map = new Map<string, QuestNodeData>();
    for (const q of payload?.nodes ?? []) map.set(q.id, q);
    return map;
  }, [payload]);

  const activeTypes = useMemo(() => {
    const types = new Set<QuestType>();
    for (const cat of CATEGORIES) {
      if (activeCats.has(cat.key)) {
        for (const t of cat.types) types.add(t);
      }
    }
    return types;
  }, [activeCats]);

  const filteredQuests = useMemo(() => {
    if (!payload) return [];
    const term = search.trim().toLowerCase();
    return payload.nodes.filter((q) => {
      if (!activeTypes.has(q.type)) return false;
      if (onlyWithIconics && q.rewards.length === 0) return false;
      if (term) {
        const hitTitle = q.title.toLowerCase().includes(term);
        const hitId = q.id.toLowerCase().includes(term);
        const hitGiver = q.giver.toLowerCase().includes(term);
        const hitReward = q.rewards.some((r) => r.name.toLowerCase().includes(term));
        if (!hitTitle && !hitId && !hitGiver && !hitReward) return false;
      }
      return true;
    });
  }, [payload, activeTypes, onlyWithIconics, search]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setLayouting(true);
    layoutQuestGraph(
      filteredQuests,
      payload.edges,
      allQuestsMap,
      doneQuests,
      doneIconics,
      toggleQuestDone,
    ).then(({ nodes, edges }) => {
      if (cancelled) return;
      setBaseNodes(nodes);
      setBaseEdges(edges);
      setLayouting(false);
    });
    return () => {
      cancelled = true;
    };
}, [payload, filteredQuests, allQuestsMap, doneQuests, doneIconics, toggleQuestDone]);

const { nodes: flowNodes, edges: flowEdges } = useMemo(
  () => applySelectionHighlight(baseNodes, baseEdges, selectedId),
  [baseNodes, baseEdges, selectedId],
);

const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
  saveViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
}, []);

const focusQuest = useCallback(
  (questId: string) => {
    setSelectedId(questId);
    const node = flowNodes.find((n) => n.id === questId);
    if (node) {
      setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom: 1, duration: 400 },
      );
    }
  },
  [flowNodes, setCenter],
);

const totalIconics = useMemo(() => {
  if (!payload) return 0;
  return payload.nodes.reduce((acc, q) => acc + q.rewards.length, 0);
}, [payload]);

const selectedQuest = selectedId ? allQuestsMap.get(selectedId) ?? null : null;

const toggleCategory = (key: string) => {
  setActiveCats((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
};

if (error) {
  return (
    <div className="loading-screen">
      <h2>Failed to load quest graph</h2>
      <p>{error}</p>
    </div>
  );
}

if (!payload) {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Loading Night City quest database…</p>
    </div>
  );
}

return (
  <div className="app-shell">
    <header className="topbar">
      <div className="topbar__brand">
        <span className="brand-tag">CP2077 // PL</span>
        <h1>Questline Graph</h1>
      </div>

      <div className="topbar__search">
        <Search size={15} />
        <input
          type="text"
          placeholder="Search quest, ID, giver, or iconic…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="topbar__filters">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className={`filter-chip ${activeCats.has(cat.key) ? 'filter-chip--active' : ''}`}
            onClick={() => toggleCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
        <button
          type="button"
          className={`filter-chip ${onlyWithIconics ? 'filter-chip--iconic' : ''}`}
          onClick={() => setOnlyWithIconics((v) => !v)}
          title="Show only quests with notable/iconic rewards"
        >
          Has Iconics
        </button>
      </div>

      <div className="topbar__stats">
        <span className="stat-pill" title="Quests marked done (saved in browser)">
          <CheckCircle2 size={14} />
          {doneQuests.size}/{payload.nodes.length}
        </span>
        <span className="stat-pill stat-pill--gold" title="Iconic/notable rewards collected (saved in browser)">
          <Trophy size={14} />
          {doneIconics.size}/{totalIconics}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => fitView({ duration: 400 })}
          title="Fit graph to screen"
        >
          Fit
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={handleResetProgress}
          title="Reset local progress"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </header>

    <div className="workspace">
      <div className="graph-pane">
        {layouting && <div className="layout-banner">Computing graph layout…</div>}
        <div className="legend">
          <span><i className="leg-line leg-line--unlock" /> Unlocks</span>
          <span><i className="leg-line leg-line--and" /> [+] Requires All</span>
          <span><i className="leg-line leg-line--choice" /> [!] Dialogue / Choice Split</span>
          <span><i className="leg-line leg-line--during" /> Takes Place During</span>
        </div>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            if (node.type === 'questNode') setSelectedId(node.id);
          }}
          onPaneClick={() => setSelectedId(null)}
          onMoveEnd={handleMoveEnd}
          defaultViewport={savedViewport ?? undefined}
          fitView={!savedViewport}
          minZoom={0.1}
          maxZoom={2}
          colorMode="dark"
        >
          <Background color="#1e293b" gap={24} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'stubNode') return '#1e293b';
              return (n.data as FlowQuestNodeData)?.done ? '#22c55e' : '#334155';
            }}
            maskColor="rgba(10, 11, 16, 0.75)"
          />
        </ReactFlow>
      </div>

      {selectedQuest && (
        <QuestDrawer
          quest={selectedQuest}
          allQuestsMap={allQuestsMap}
          edges={payload.edges}
          doneQuests={doneQuests}
          doneIconics={doneIconics}
          onToggleQuestDone={toggleQuestDone}
          onToggleIconicDone={toggleIconicDone}
          onSelectQuest={focusQuest}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  </div>
);
}

export function App() {
  return (
    <ReactFlowProvider>
      <QuestGraphApp />
    </ReactFlowProvider>
  );
}
