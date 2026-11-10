export interface SeatFolder {
  path: string;
  name: string;
  seat: string;
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
