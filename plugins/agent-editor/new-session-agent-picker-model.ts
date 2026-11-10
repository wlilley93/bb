import { homeRows, type HomeRow, type SeatFolder } from "./seat-folders.js";

export interface PickerEntry {
  key: string;
  seatId: string;
  tier: string;
  name: string;
  role: string;
  headKey: string;
  depth: number;
  ancestors: string[];
}

export interface PickerGroup {
  headKey: string;
  entries: PickerEntry[];
}

export const SEARCH_THRESHOLD = 8;

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function seatStem(id: string): string {
  const stem = id.replace(/^(?:head|vp|pm)-/, "");
  if (stem === id) return id === "vp" || id === "pm" ? id.toUpperCase() : titleCase(id);
  return titleCase(stem);
}

export function roleLabel(seat: { id: string; tier: string }): string {
  if (seat.tier === "head" && seat.id.startsWith("head-")) return `Head of ${seatStem(seat.id)}`;
  if (seat.tier === "vp") return "VP";
  if (seat.tier === "pm") return "PM";
  return seatStem(seat.id);
}

export function rowKey(row: HomeRow): string {
  return row.folder.path;
}

export function buildGroups(
  seats: readonly { id: string; tier: string }[],
  folders: readonly SeatFolder[],
): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const walk = (row: HomeRow, headKey: string, depth: number, ancestors: string[], into: PickerEntry[]) => {
    const key = rowKey(row);
    into.push({
      key,
      seatId: row.seat.id,
      tier: row.seat.tier,
      name: row.folder.name,
      role: roleLabel(row.seat),
      headKey,
      depth,
      ancestors,
    });
    for (const child of row.children) walk(child, headKey, depth + 1, [...ancestors, key], into);
  };
  for (const root of homeRows(seats, folders)) {
    const headKey = rowKey(root);
    const entries: PickerEntry[] = [];
    walk(root, headKey, 0, [], entries);
    groups.push({ headKey, entries });
  }
  return groups;
}

export function flatten(groups: readonly PickerGroup[]): PickerEntry[] {
  return groups.flatMap((group) => group.entries);
}

export function needsSearch(groups: readonly PickerGroup[]): boolean {
  return flatten(groups).length > SEARCH_THRESHOLD;
}

export function filterGroups(groups: readonly PickerGroup[], query: string): PickerGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((group) => ({
      headKey: group.headKey,
      entries: group.entries.filter((entry) =>
        entry.name.toLowerCase().includes(needle)
        || entry.role.toLowerCase().includes(needle)
        || entry.seatId.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.entries.length > 0);
}

/**
 * The compact view mirrors the sidebar: every head, and the folders of the head
 * that holds the current row. A search or the expanded view shows everything.
 */
export function visibleGroups(
  groups: readonly PickerGroup[],
  options: { currentKey: string | null; expanded: boolean; query: string },
): PickerGroup[] {
  if (options.query.trim() || options.expanded) return filterGroups(groups, options.query);
  const currentHead = options.currentKey
    ? groups.find((group) => group.entries.some((entry) => entry.key === options.currentKey))?.headKey ?? null
    : null;
  return groups.map((group) => ({
    headKey: group.headKey,
    entries: group.headKey === currentHead ? group.entries : group.entries.slice(0, 1),
  }));
}

export interface SelectionSources {
  activeFolder: string | null;
  activeSeat: string | null;
  lastUsed: string | null;
}

export function resolveCurrent(groups: readonly PickerGroup[], sources: SelectionSources): PickerEntry | null {
  const entries = flatten(groups);
  const byKey = (key: string | null) => (key ? entries.find((entry) => entry.key === key) ?? null : null);
  const bySeat = (seatId: string | null) => (seatId ? entries.find((entry) => entry.seatId === seatId) ?? null : null);
  return byKey(sources.activeFolder) ?? bySeat(sources.activeSeat) ?? byKey(sources.lastUsed) ?? bySeat(sources.lastUsed);
}

export function isSidebarSelection(sources: SelectionSources, entries: readonly PickerEntry[]): boolean {
  if (sources.activeFolder && entries.some((entry) => entry.key === sources.activeFolder)) return true;
  return Boolean(sources.activeSeat && entries.some((entry) => entry.seatId === sources.activeSeat));
}

export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + delta));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSeats(raw: unknown): { id: string; tier: string }[] | null {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.result) || !Array.isArray(raw.result.seats)) return null;
  const seats: { id: string; tier: string }[] = [];
  for (const item of raw.result.seats) {
    if (isRecord(item) && typeof item.id === "string" && typeof item.tier === "string") {
      seats.push({ id: item.id, tier: item.tier });
    }
  }
  return seats;
}

export function parseFolders(raw: unknown): SeatFolder[] | null {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.result) || !Array.isArray(raw.result.folders)) return null;
  const folders: SeatFolder[] = [];
  for (const item of raw.result.folders) {
    if (
      isRecord(item)
      && typeof item.path === "string"
      && typeof item.name === "string"
      && typeof item.seat === "string"
      && typeof item.tier === "string"
    ) {
      folders.push({ path: item.path, name: item.name, seat: item.seat, tier: item.tier });
    }
  }
  return folders;
}
