export interface SeatFolder {
  path: string;
  name: string;
  seat: string;
  tier: string;
}

export interface HomeRow {
  seat: { id: string; tier: string };
  folder: SeatFolder;
  children: HomeRow[];
}

export interface NestedSeatFolder extends SeatFolder {
  children: NestedSeatFolder[];
}

/**
 * Nest recorded folders by the directory that holds them.
 * A PM folder is the last row: nothing below it is drawn.
 */
export function nestSeatFolders(
  folders: readonly SeatFolder[],
  pmSeats: ReadonlySet<string>,
): NestedSeatFolder[] {
  const parentOf = new Map<string, string | null>();
  for (const folder of folders) {
    let parent: string | null = null;
    for (const other of folders) {
      if (other.path === folder.path) continue;
      if (!folder.path.startsWith(`${other.path}/`)) continue;
      if (!parent || other.path.length > parent.length) parent = other.path;
    }
    parentOf.set(folder.path, parent);
  }
  const byParent = new Map<string | null, SeatFolder[]>();
  for (const folder of folders) {
    const parent = parentOf.get(folder.path) ?? null;
    const list = byParent.get(parent) ?? [];
    list.push(folder);
    byParent.set(parent, list);
  }
  const byName = (left: SeatFolder, right: SeatFolder) =>
    left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
  const visit = (folder: SeatFolder): NestedSeatFolder => ({
    ...folder,
    children: pmSeats.has(folder.seat)
      ? []
      : (byParent.get(folder.path) ?? []).sort(byName).map(visit),
  });
  return (byParent.get(null) ?? []).sort(byName).map(visit);
}

const managedTier = new Set(["head", "vp", "pm"]);
const looseSeat = new Set(["vp", "pm"]);

/** Rows are the recorded homes. An installed agent with no `.meta` home is not a row. */
export function homeRows(
  seats: readonly { id: string; tier: string }[],
  folders: readonly SeatFolder[],
): HomeRow[] {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const kept = folders.filter((folder) =>
    managedTier.has(folder.tier) && !looseSeat.has(folder.seat) && byId.has(folder.seat));
  const pm = new Set(kept.filter((folder) => folder.tier === "pm").map((folder) => folder.seat));
  const visit = (folder: NestedSeatFolder): HomeRow | null => {
    const seat = byId.get(folder.seat);
    if (!seat) return null;
    const children = folder.children.flatMap((child) => {
      const node = visit(child);
      return node ? [node] : [];
    });
    return { seat: { id: seat.id, tier: folder.tier }, folder, children };
  };
  const roots: HomeRow[] = [];
  const nested = nestSeatFolders(kept, pm);
  for (const folder of liveHeadFolders(nested.filter((folder) => folder.tier === "head"))) {
    const node = visit(folder);
    if (node) roots.push(node);
  }
  roots.sort((left, right) => left.seat.id.localeCompare(right.seat.id));
  return roots;
}

/** One folder per head. A shallower copy is the live one; a deeper copy is a backup. */
export function liveHeadFolders(folders: readonly NestedSeatFolder[]): NestedSeatFolder[] {
  const chosen = new Map<string, NestedSeatFolder>();
  const depth = (folder: NestedSeatFolder) => folder.path.split("/").filter(Boolean).length;
  for (const folder of folders) {
    const current = chosen.get(folder.seat);
    if (!current || depth(folder) < depth(current)) chosen.set(folder.seat, folder);
  }
  return [...chosen.values()];
}
