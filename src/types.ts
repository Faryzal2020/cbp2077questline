export type QuestType =
  | 'M'
  | 'MI'
  | 'PL'
  | 'E'
  | 'PLE'
  | 'S'
  | 'SI'
  | 'G'
  | 'CP'
  | 'T'
  | 'IC';

export type RewardMethod = 'quest_reward' | 'npc_drop' | 'world_pickup' | 'unknown';

export interface QuestReward {
  name: string;
  method: RewardMethod;
  missable: boolean;
  note?: string;
}

export interface FactRequirement {
  factName: string;
  comparison: string;
  value: number;
}

export interface QuestNodeData {
  id: string;
  type: QuestType;
  title: string;
  giver: string;
  arc: string;
  parallelGroup: string | null;
  journalId: string | null;
  journalPath: string | null;
  gameQuestType: string | null;
  district: string | null;
  rewards: QuestReward[];
  reqText: string;
  ponr: boolean;
  repeatable: boolean;
  during: string | null;
  factsRequired: FactRequirement[];
}

export type EdgeKind = 'unlock' | 'and' | 'choice' | 'during';

export interface QuestEdgeData {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
}

export interface QuestGraphPayload {
  meta: {
    totalNodes: number;
    totalEdges: number;
    excludedTypes: string[];
  };
  nodes: QuestNodeData[];
  edges: QuestEdgeData[];
}
