import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Check, GitBranch, Gift, AlertTriangle } from 'lucide-react';
import type { FlowQuestNodeData } from '../utils/layout';
import type { QuestType } from '../types';

const TYPE_COLORS: Record<QuestType, string> = {
  M: '#fcee09',
  MI: '#fde047',
  PL: '#ff2a6d',
  E: '#f59e0b',
  PLE: '#fb7185',
  S: '#00f0ff',
  SI: '#38bdf8',
  G: '#22c55e',
  CP: '#f97316',
  T: '#a855f7',
  IC: '#ec4899',
};

function QuestNodeComponent({ data, selected }: NodeProps<Node<FlowQuestNodeData>>) {
  const { quest, done, doneIconicsCount, hasChoiceBranch, hasChoiceRequirement, onToggleDone } = data;
  const accent = TYPE_COLORS[quest.type] ?? '#94a3b8';
  const totalRewards = quest.rewards.length;
  const hasMissable = quest.rewards.some((r) => r.missable);

  return (
    <div
      className={`quest-node ${done ? 'quest-node--done' : ''} ${selected ? 'quest-node--selected' : ''}`}
      style={{ '--type-accent': accent } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="quest-handle" />

      <div className="quest-node__header">
        <span className="quest-node__id" style={{ backgroundColor: accent }}>
          {quest.id}
        </span>
        <span className="quest-node__giver" title={quest.giver}>
          {quest.giver}
        </span>
        <button
          type="button"
          className={`quest-node__check ${done ? 'quest-node__check--active' : ''}`}
          title={done ? 'Mark quest as not done' : 'Mark quest as done'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(quest.id);
          }}
        >
          <Check size={13} strokeWidth={3} />
        </button>
      </div>

      <div className="quest-node__title" title={quest.title}>
        {quest.title}
      </div>

      <div className="quest-node__badges">
        {(hasChoiceBranch || hasChoiceRequirement) && (
          <span
            className="badge badge--choice"
            title={
              hasChoiceBranch
                ? 'Dialogue/story choice splits into different quest outcomes'
                : 'Outcome depends on prior dialogue/story choices'
            }
          >
            <GitBranch size={11} />
            {hasChoiceBranch ? '[!] Choice Split' : 'Choice Outcome'}
          </span>
        )}
        {quest.ponr && (
          <span className="badge badge--ponr" title="Point of No Return">
            <AlertTriangle size={11} />
            PONR
          </span>
        )}
        {totalRewards > 0 && (
          <span
            className={`badge ${doneIconicsCount === totalRewards ? 'badge--reward-done' : 'badge--reward'}`}
            title={hasMissable ? 'Contains missable iconic/notable reward(s)' : 'Notable rewards'}
          >
            <Gift size={11} />
            {doneIconicsCount}/{totalRewards}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="quest-handle" />
    </div>
  );
}

export const QuestNode = memo(QuestNodeComponent);
