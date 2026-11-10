export interface Seat {
  rank: "vp" | "pm" | "head";
  area: string;
}

export function seatOf(agent: string | null): Seat | null {
  if (!agent) return null;
  const match = /^(vp|pm|head)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(agent);
  if (!match) return null;
  const rank = match[1];
  if (rank !== "vp" && rank !== "pm" && rank !== "head") return null;
  return { rank, area: match[2] };
}

export function agentFromTimeline(timeline: unknown): string | null {
  if (!timeline || typeof timeline !== "object") return null;
  const options = (timeline as { sessionOptions?: unknown }).sessionOptions;
  if (!Array.isArray(options)) return null;
  for (const option of options) {
    if (!option || typeof option !== "object") continue;
    const record = option as { id?: unknown; value?: unknown; pendingValue?: unknown };
    if (record.id !== "mode") continue;
    if (typeof record.pendingValue === "string" && record.pendingValue.length > 0) return record.pendingValue;
    if (typeof record.value === "string") return record.value;
  }
  return null;
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function sameToken(left: string, right: string): boolean {
  if (left === right) return true;
  if ((left === "ops" && right === "operations") || (right === "ops" && left === "operations")) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  return shorter.length >= 5 && longer.startsWith(shorter);
}

export function matchByName<T extends { name: string }>(area: string, items: readonly T[]): T | null {
  const want = tokens(area);
  if (want.length === 0) return null;
  let best: T | null = null;
  for (const item of items) {
    const have = tokens(item.name);
    const used = new Set<number>();
    let matched = true;
    for (const token of want) {
      const index = have.findIndex((name, position) => !used.has(position) && sameToken(name, token));
      if (index < 0) {
        matched = false;
        break;
      }
      used.add(index);
    }
    if (!matched || have.length !== used.size) continue;
    best = item;
  }
  return best;
}
