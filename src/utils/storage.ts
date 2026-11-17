const QUESTS_KEY = 'cbp2077_done_quests_v1';
const ICONICS_KEY = 'cbp2077_done_iconics_v1';

export function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore quota errors
  }
}

export function loadDoneQuests(): Set<string> {
  return loadSet(QUESTS_KEY);
}

export function saveDoneQuests(set: Set<string>): void {
  saveSet(QUESTS_KEY, set);
}

export function loadDoneIconics(): Set<string> {
  return loadSet(ICONICS_KEY);
}

export function saveDoneIconics(set: Set<string>): void {
  saveSet(ICONICS_KEY, set);
}

export function iconicKey(questId: string, rewardName: string): string {
  return `${questId}::${rewardName}`;
}

export function youtubeSearchUrl(iconicName: string): string {
  const query = `cyberpunk 2077 how to get ${iconicName}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
