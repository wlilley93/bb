export const DEFAULT_TREE_WIDTH = 240;

export const MIN_TREE_WIDTH = 160;

export const MIN_EDITOR_WIDTH = 160;

const STORAGE_KEY = "bb-plugin-monaco-editor:file-tree-width";

export function clampTreeWidth(width: number, available: number): number {
  const max = Math.max(MIN_TREE_WIDTH, available - MIN_EDITOR_WIDTH);
  return Math.round(Math.min(Math.max(width, MIN_TREE_WIDTH), max));
}

export function readStoredTreeWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_TREE_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TREE_WIDTH;
    return Math.max(parsed, MIN_TREE_WIDTH);
  } catch {
    return DEFAULT_TREE_WIDTH;
  }
}

export function storeTreeWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {}
}
