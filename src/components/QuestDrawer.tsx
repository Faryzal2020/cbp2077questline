import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  AlertTriangle,
  X,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import type { QuestEdgeData, QuestNodeData, RewardMethod } from '../types';
import { iconicKey, youtubeSearchUrl } from '../utils/storage';

interface QuestDrawerProps {
  quest: QuestNodeData;
  allQuestsMap: Map<string, QuestNodeData>;
  edges: QuestEdgeData[];
  doneQuests: Set<string>;
  doneIconics: Set<string>;
  onToggleQuestDone: (questId: string) => void;
  onToggleIconicDone: (questId: string, rewardName: string) => void;
  onSelectQuest: (questId: string) => void;
  onClose: () => void;
}

const METHOD_LABEL: Record<RewardMethod, string> = {
  quest_reward: 'Quest Reward',
  npc_drop: 'NPC Drop',
  world_pickup: 'World Pickup',
  unknown: 'Other',
};

export function QuestDrawer({
  quest,
  allQuestsMap,
  edges,
  doneQuests,
  doneIconics,
  onToggleQuestDone,
  onToggleIconicDone,
  onSelectQuest,
  onClose,
}: QuestDrawerProps) {
  const [showFacts, setShowFacts] = useState(false);

  const isDone = doneQuests.has(quest.id);
  const incoming = edges.filter((e) => e.target === quest.id);
  const outgoing = edges.filter((e) => e.source === quest.id);

  const choiceOutgoing = outgoing.filter((e) => e.kind === 'choice');
  const choiceIncoming = incoming.filter((e) => e.kind === 'choice');
  const hasExclusiveSplit = choiceOutgoing.some((e) => e.exclusive);
  const hasChoiceInfo =
    choiceOutgoing.length > 0 ||
    choiceIncoming.length > 0 ||
    /choices?\s+in/i.test(quest.reqText) ||
    quest.ponr;

  return (
    <aside className="drawer">
      <div className="drawer__header">
        <div>
          <div className="drawer__eyebrow">
            <span className="drawer__id">{quest.id}</span>
            <span className="drawer__arc">{quest.arc}</span>
            {quest.district && <span className="drawer__district">{quest.district}</span>}
          </div>
          <h2 className="drawer__title">{quest.title}</h2>
          <div className="drawer__meta">
            <span>Giver / Loc: <strong>{quest.giver}</strong></span>
            {quest.journalId && (
              <span className="drawer__journal-id" title={quest.journalPath ?? undefined}>
                <code>{quest.journalId}</code>
              </span>
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </div>

      <div className="drawer__done-bar">
        <button
          type="button"
          className={`done-toggle ${isDone ? 'done-toggle--active' : ''}`}
          onClick={() => onToggleQuestDone(quest.id)}
        >
          <Check size={15} strokeWidth={3} />
          {isDone ? 'Quest Done' : 'Mark Quest Done'}
        </button>
        {quest.repeatable && <span className="pill">Repeatable</span>}
        {quest.ponr && (
          <span className="pill pill--ponr">
            <AlertTriangle size={12} /> Point of No Return
          </span>
        )}
      </div>

      <div className="drawer__body">
        {/* Dialogue Choices & Outcomes */}
        <section className={`drawer__section ${hasChoiceInfo ? 'drawer__section--choice' : ''}`}>
          <h3 className="drawer__section-title">
            <GitBranch size={14} /> Requirements &amp; Dialogue Outcomes
          </h3>
          {quest.reqText && quest.reqText !== '—' ? (
            <p className="drawer__req-text">{quest.reqText}</p>
          ) : (
            <p className="drawer__muted">No special prerequisites beyond unlocking edges.</p>
          )}

          {choiceOutgoing.length > 0 && (
            <div className="choice-box">
              <div className="choice-box__title">
                {hasExclusiveSplit
                  ? `[!] CRITICAL SPLIT (Mutually Exclusive) in ${quest.id}`
                  : `[!] Branching Outcomes from ${quest.id}`}
              </div>
              <p className="choice-box__desc">
                {hasExclusiveSplit
                  ? 'Picking one of these paths permanently locks out the other(s) on this playthrough:'
                  : 'Choices in this quest lead to different outcomes:'}
              </p>
              <div className="choice-detail-list">
                {choiceOutgoing.map((e) => {
                  const target = allQuestsMap.get(e.target);
                  return (
                    <div key={e.id} className="choice-detail-item">
                      <button
                        type="button"
                        className="jump-chip jump-chip--choice"
                        onClick={() => onSelectQuest(e.target)}
                      >
                        <strong>{e.target}</strong>
                        <span>{target?.title ?? e.target}</span>
                        {e.exclusive && <em className="tag-exclusive">Exclusive</em>}
                        <ArrowRight size={12} />
                      </button>
                      {e.condition && <p className="choice-detail-cond">{e.condition}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {choiceIncoming.length > 0 && (
            <div className="choice-box choice-box--incoming">
              <div className="choice-box__title">Required Choice to Unlock:</div>
              <div className="choice-detail-list">
                {choiceIncoming.map((e) => {
                  const src = allQuestsMap.get(e.source);
                  return (
                    <div key={e.id} className="choice-detail-item">
                      <button
                        type="button"
                        className="jump-chip jump-chip--choice"
                        onClick={() => onSelectQuest(e.source)}
                      >
                        <ArrowLeft size={12} />
                        <strong>{e.source}</strong>
                        <span>{src?.title ?? e.source}</span>
                        {e.exclusive && <em className="tag-exclusive">Exclusive</em>}
                      </button>
                      {e.condition && <p className="choice-detail-cond">{e.condition}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {quest.factsRequired.length > 0 && (
            <div className="facts-accordion">
              <button
                type="button"
                className="facts-accordion__toggle"
                onClick={() => setShowFacts((v) => !v)}
              >
                {showFacts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                In-Game Fact Conditions ({quest.factsRequired.length})
              </button>
              {showFacts && (
                <ul className="facts-list">
                  {quest.factsRequired.slice(0, 30).map((f, idx) => (
                    <li key={`${f.factName}-${idx}`}>
                      <code>{f.factName}</code> {f.comparison} <code>{f.value}</code>
                    </li>
                  ))}
                  {quest.factsRequired.length > 30 && (
                    <li className="drawer__muted">
                      …and {quest.factsRequired.length - 30} more internal facts
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Notable & Iconic Rewards */}
        <section className="drawer__section">
          <h3 className="drawer__section-title">
            Notable &amp; Iconic Rewards ({quest.rewards.length})
          </h3>
          {quest.rewards.length === 0 ? (
            <p className="drawer__muted">No notable iconic items recorded for this quest.</p>
          ) : (
            <ul className="reward-list">
              {quest.rewards.map((r) => {
                const k = iconicKey(quest.id, r.name);
                const collected = doneIconics.has(k);
                return (
                  <li key={k} className={`reward-item ${collected ? 'reward-item--done' : ''}`}>
                    <button
                      type="button"
                      className={`reward-check ${collected ? 'reward-check--active' : ''}`}
                      title={collected ? 'Mark iconic as not collected' : 'Mark iconic as collected'}
                      onClick={() => onToggleIconicDone(quest.id, r.name)}
                    >
                      <Check size={13} strokeWidth={3} />
                    </button>
                    <div className="reward-item__info">
                      <a
                        href={youtubeSearchUrl(r.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="reward-link"
                        title={`Search YouTube: cyberpunk 2077 how to get ${r.name}`}
                      >
                        <span>{r.name}</span>
                        <ExternalLink size={12} />
                      </a>
                      <div className="reward-item__tags">
                        <span className={`method-tag method-tag--${r.method}`}>
                          {METHOD_LABEL[r.method] ?? r.method}
                        </span>
                        {r.missable && <span className="method-tag method-tag--missable">Missable</span>}
                      </div>
                      {r.note && <p className="reward-item__note">{r.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Graph Connections */}
        {(incoming.length > 0 || outgoing.length > 0) && (
          <section className="drawer__section">
            <h3 className="drawer__section-title">Connections</h3>
            {incoming.length > 0 && (
              <div className="conn-group">
                <div className="conn-group__label">Unlocked From</div>
                <div className="jump-list">
                  {incoming.map((e) => {
                    const src = allQuestsMap.get(e.source);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className="jump-chip"
                        onClick={() => onSelectQuest(e.source)}
                      >
                        <ArrowLeft size={12} />
                        <strong>{e.source}</strong>
                        <span>{src?.title ?? e.source}</span>
                        {e.label && <em>{e.label}</em>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {outgoing.length > 0 && (
              <div className="conn-group">
                <div className="conn-group__label">Unlocks</div>
                <div className="jump-list">
                  {outgoing.map((e) => {
                    const tgt = allQuestsMap.get(e.target);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className="jump-chip"
                        onClick={() => onSelectQuest(e.target)}
                      >
                        <strong>{e.target}</strong>
                        <span>{tgt?.title ?? e.target}</span>
                        {e.label && <em>{e.label}</em>}
                        <ArrowRight size={12} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
