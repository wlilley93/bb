/** The one person on this server until bb has accounts. */
export const LOCAL_SEAT_PERSON_KEY = "local";

export interface SeatTreeItem {
  id: string;
  parentProjectId?: string | null;
}

export interface Seated<T> {
  item: T;
  depth: number;
}

/** Parents before their children. Siblings keep the order they arrived in. */
export function orderSeatTree<T extends SeatTreeItem>(items: readonly T[]): Seated<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const byParent = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = item.parentProjectId && ids.has(item.parentProjectId)
      ? item.parentProjectId
      : null;
    const list = byParent.get(parent);
    if (list) list.push(item);
    else byParent.set(parent, [item]);
  }
  const ordered: Seated<T>[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const item of byParent.get(parent) ?? []) {
      ordered.push({ item, depth });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}
