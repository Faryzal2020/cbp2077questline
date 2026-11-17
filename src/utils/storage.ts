const QUESTS_KEY = 'cbp2077_done_quests_v1';
const ICONICS_KEY = 'cbp2077_done_iconics_v1';
const FILTERS_KEY = 'cbp2077_filters_v1';
const VIEWPORT_KEY = 'cbp2077_viewport_v1';

export interface SavedFilters {
  activeCats: string[];
  onlyWithIconics: boolean;
  search: string;
}

export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

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

export function loadFilters(defaultCats: string[]): SavedFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return { activeCats: defaultCats, onlyWithIconics: false, search: '' };
    const parsed = JSON.parse(raw);
    return {
      activeCats: Array.isArray(parsed.activeCats) ? parsed.activeCats.map(String) : defaultCats,
      onlyWithIconics: Boolean(parsed.onlyWithIconics),
      search: typeof parsed.search === 'string' ? parsed.search : '',
    };
  } catch {
    return { activeCats: defaultCats, onlyWithIconics: false, search: '' };
  }
}

export function saveFilters(filters: SavedFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota errors
  }
}

export function loadViewport(): SavedViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.zoom === 'number') {
      return { x: p.x, y: p.y, zoom: p.zoom };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveViewport(vp: SavedViewport): void {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(vp));
  } catch {
    // ignore quota errors
  }
}

export function iconicKey(questId: string, rewardName: string): string {
  return `${questId}::${rewardName}`;
}

export function youtubeSearchUrl(iconicName: string): string {
  const query = `cyberpunk 2077 how to get ${iconicName}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
