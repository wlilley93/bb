import type { ThreadSessionOption } from "@bb/domain";

function tierOf(id: string): "head" | "vp" | "pm" | null {
  if (id.startsWith("head-")) return "head";
  if (id.startsWith("vp-")) return "vp";
  if (id.startsWith("pm-")) return "pm";
  return null;
}

function parentSeatId(id: string, ids: ReadonlySet<string>): string | null {
  const tier = tierOf(id);
  if (tier === "vp") {
    const head = `head-${id.slice(3)}`;
    return ids.has(head) ? head : null;
  }
  if (tier === "pm") {
    const vp = `vp-${id.slice(3)}`;
    if (ids.has(vp)) return vp;
    const head = `head-${id.slice(3)}`;
    if (ids.has(head)) return head;
  }
  return null;
}

/** The head that owns `agentId`, plus every seat that rolls up to that head. */
export function agentTreeIds(
  seatIds: readonly string[],
  agentId: string,
): ReadonlySet<string> {
  const ids = new Set(seatIds);
  ids.add(agentId);
  let head = agentId;
  const seen = new Set<string>();
  while (!seen.has(head)) {
    seen.add(head);
    const parent = parentSeatId(head, ids);
    if (parent === null) break;
    head = parent;
  }
  const tree = new Set<string>([head]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of ids) {
      if (tree.has(id)) continue;
      const parent = parentSeatId(id, ids);
      if (parent !== null && tree.has(parent)) {
        tree.add(id);
        grew = true;
      }
    }
  }
  return tree;
}

export function readAgentModeCatalog(options: readonly ThreadSessionOption[]): {
  ids: readonly string[];
  labels: ReadonlyMap<string, string>;
} {
  const mode = options.find((option) => option.id === "mode");
  if (mode === undefined || mode.type !== "select") {
    return { ids: [], labels: new Map() };
  }
  const labels = new Map<string, string>();
  const ids: string[] = [];
  for (const value of mode.values) {
    ids.push(value.id);
    labels.set(value.id, value.label);
  }
  return { ids, labels };
}

export interface PublishedAgentTree {
  head: string;
  seats: readonly string[];
}

export function publishedTreeForAgent(
  trees: readonly PublishedAgentTree[],
  agentId: string,
): ReadonlySet<string> | null {
  const match = trees.find(
    (tree) => tree.head === agentId || tree.seats.includes(agentId),
  );
  if (match === undefined) return null;
  return new Set(match.seats);
}

export function threadsInAgentTree<T extends { id: string }>(
  threads: readonly T[],
  args: {
    agentId: string;
    modeByThreadId: ReadonlyMap<string, string | null>;
    seatIds: readonly string[];
    treeIds?: ReadonlySet<string> | null;
  },
): T[] {
  const tree = args.treeIds ?? agentTreeIds(args.seatIds, args.agentId);
  return threads.filter((thread) => {
    const mode = args.modeByThreadId.get(thread.id);
    return mode !== undefined && mode !== null && tree.has(mode);
  });
}
