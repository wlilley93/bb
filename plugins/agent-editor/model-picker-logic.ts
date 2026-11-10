export interface RuntimeInfo {
  id: string;
  label: string;
  logoUrl: string | null;
}

export interface PickerModel {
  key: string;
  runtimeId: string;
  runtimeLabel: string;
  logoUrl: string | null;
  value: string;
  label: string;
  routeProviderId: string | null;
  group: string;
  isDefault: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

export interface RawModel {
  value: string;
  label: string;
  routeProviderId?: string | null | undefined;
  isDefault?: boolean | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
}

export interface GroupBlock {
  group: string;
  models: PickerModel[];
}

export const MAIN_LIST_LIMIT = 6;
export const SPLIT_THRESHOLD = 12;
const PER_GROUP_FEATURED = 2;
export const OTHER_GROUP = "Other";

const GROUP_RANK = ["OpenAI", "Anthropic", "Cursor"];

const ROUTE_GROUPS: Record<string, string> = {
  "claude-agent": "Anthropic",
  anthropic: "Anthropic",
  openai: "OpenAI",
  codex: "OpenAI",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  inception: "Inception",
  "kimi-code-plan-global": "Kimi",
  kimi: "Kimi",
  moonshot: "Kimi",
  nanogpt: "NanoGPT",
  ollama: "Ollama",
  "ollama-local": "Ollama",
  opencode: "OpenCode",
  reflection: "Reflection",
  "zai-coding-plan": "Z.ai",
  zai: "Z.ai",
  google: "Google",
  xai: "xAI",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

const RUNTIME_GROUPS: Record<string, string> = {
  codex: "OpenAI",
  "claude-code": "Anthropic",
  "acp-cursor": "Cursor",
};

const NATIVE_RUNTIME_BY_GROUP: Record<string, string> = {
  OpenAI: "codex",
  Anthropic: "claude-code",
  Cursor: "acp-cursor",
};

function titleCase(value: string): string {
  return value
    .replace(/-(?:coding-plan|global|plan)\b/gu, "")
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function groupForRoute(routeProviderId: string): string {
  const mapped = ROUTE_GROUPS[routeProviderId.toLowerCase()];
  if (mapped !== undefined) return mapped;
  const title = titleCase(routeProviderId);
  return title.length > 0 ? title : OTHER_GROUP;
}

export function groupForName(label: string): string | null {
  const text = label.toLowerCase();
  if (/\b(claude|opus|sonnet|haiku|fable)\b/u.test(text)) return "Anthropic";
  if (/\bgpt\b|\bo[1-9]\b|\bcodex\b/u.test(text)) return "OpenAI";
  if (/\bgrok\b/u.test(text)) return "xAI";
  if (/\bgemini\b/u.test(text)) return "Google";
  if (/\bcomposer\b|^auto$|^default$/u.test(text)) return "Cursor";
  return null;
}

export function resolveGroup(runtimeId: string, runtimeLabel: string, label: string, routeProviderId: string | null | undefined): string {
  if (routeProviderId !== null && routeProviderId !== undefined && routeProviderId.length > 0) {
    return groupForRoute(routeProviderId);
  }
  const fixed = RUNTIME_GROUPS[runtimeId];
  if (fixed !== undefined && runtimeId !== "acp-cursor") return fixed;
  const byName = groupForName(label);
  if (byName !== null) return byName;
  if (runtimeId === "acp-cursor") return "Cursor";
  return runtimeLabel.length > 0 ? titleCase(runtimeLabel) : OTHER_GROUP;
}

export function toPickerModel(runtime: RuntimeInfo, raw: RawModel): PickerModel {
  const route = raw.routeProviderId ?? null;
  return {
    key: `${runtime.id}::${raw.value}`,
    runtimeId: runtime.id,
    runtimeLabel: runtime.label,
    logoUrl: runtime.logoUrl,
    value: raw.value,
    label: raw.label,
    routeProviderId: route,
    group: resolveGroup(runtime.id, runtime.label, raw.label, route),
    isDefault: raw.isDefault === true,
    disabled: raw.disabled === true,
    disabledReason: raw.disabledReason ?? null,
  };
}

export function normalizeName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\((?:[^()]*)\)/gu, "")
    .replace(/^claude[\s-]+/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

export function versionVector(label: string): number[] {
  const cleaned = label.replace(/\b\d{6,}\b/gu, " ");
  const found: number[] = [];
  const pattern = /\d+(?:\.\d+)*/gu;
  for (const match of cleaned.matchAll(pattern)) {
    for (const part of match[0].split(".")) found.push(Number.parseInt(part, 10));
    if (found.length > 0) break;
  }
  return found;
}

export function compareVersionDesc(a: string, b: string): number {
  const left = versionVector(a);
  const right = versionVector(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? -1;
    const r = right[index] ?? -1;
    if (l !== r) return r - l;
  }
  return 0;
}

export function groupOrder(a: string, b: string): number {
  const rankA = GROUP_RANK.indexOf(a);
  const rankB = GROUP_RANK.indexOf(b);
  const weightA = a === OTHER_GROUP ? 2000 : rankA >= 0 ? rankA : 1000;
  const weightB = b === OTHER_GROUP ? 2000 : rankB >= 0 ? rankB : 1000;
  if (weightA !== weightB) return weightA - weightB;
  return a.localeCompare(b);
}

export function sortNewestFirst<T extends { label: string }>(models: readonly T[]): T[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((x, y) => compareVersionDesc(x.model.label, y.model.label) || x.index - y.index)
    .map((entry) => entry.model);
}

export interface DedupeResult {
  primary: PickerModel[];
  alternates: PickerModel[];
}

function preference(model: PickerModel, currentKey: string | null): number {
  if (model.key === currentKey) return 0;
  if (NATIVE_RUNTIME_BY_GROUP[model.group] === model.runtimeId) return 1;
  return 2;
}

export function dedupeAcrossRuntimes(models: readonly PickerModel[], currentKey: string | null): DedupeResult {
  const winners = new Map<string, PickerModel>();
  const losers: PickerModel[] = [];
  for (const model of models) {
    const identity = `${model.group}::${normalizeName(model.label)}`;
    const held = winners.get(identity);
    if (held === undefined) {
      winners.set(identity, model);
      continue;
    }
    if (held.runtimeId === model.runtimeId) {
      losers.push(model);
      continue;
    }
    if (preference(model, currentKey) < preference(held, currentKey)) {
      losers.push(held);
      winners.set(identity, model);
    } else {
      losers.push(model);
    }
  }
  return { primary: [...winners.values()], alternates: losers };
}

export function matchesQuery(model: PickerModel, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [model.label, model.group, model.runtimeLabel, model.routeProviderId ?? "", model.value]
    .join(" ")
    .toLowerCase();
  const squashed = haystack.replace(/[^a-z0-9]+/gu, "");
  return words.every((word) => haystack.includes(word) || squashed.includes(word.replace(/[^a-z0-9]+/gu, "")));
}

export function buildGroups(models: readonly PickerModel[]): GroupBlock[] {
  const byGroup = new Map<string, PickerModel[]>();
  for (const model of models) {
    const list = byGroup.get(model.group);
    if (list === undefined) byGroup.set(model.group, [model]);
    else list.push(model);
  }
  return [...byGroup.entries()]
    .sort((a, b) => groupOrder(a[0], b[0]))
    .map(([group, list]) => ({ group, models: sortNewestFirst(list) }))
    .filter((block) => block.models.length > 0);
}

export interface SplitInput {
  primary: readonly PickerModel[];
  alternates: readonly PickerModel[];
  recents: readonly string[];
  currentKey: string | null;
  limit?: number;
  threshold?: number;
}

export interface SplitResult {
  main: GroupBlock[];
  more: GroupBlock[];
  hasMore: boolean;
}

export function splitMainAndMore(input: SplitInput): SplitResult {
  const limit = input.limit ?? MAIN_LIST_LIMIT;
  const threshold = input.threshold ?? SPLIT_THRESHOLD;
  const total = input.primary.length + input.alternates.length;
  if (total <= threshold) {
    return { main: buildGroups([...input.primary, ...input.alternates]), more: [], hasMore: false };
  }
  const chosen = new Map<string, PickerModel>();
  const byKey = new Map(input.primary.map((model) => [model.key, model]));
  const take = (model: PickerModel | undefined): void => {
    if (model !== undefined && chosen.size < limit && !chosen.has(model.key)) chosen.set(model.key, model);
  };
  if (input.currentKey !== null) take(byKey.get(input.currentKey));
  for (const key of input.recents) take(byKey.get(key));
  const queues = buildGroups(input.primary).map((block) => [...block.models]);
  for (const queue of queues) {
    for (let count = 0; count < PER_GROUP_FEATURED; count += 1) {
      const next = queue.shift();
      if (next !== undefined) take(next);
    }
    if (chosen.size >= limit) break;
  }
  while (chosen.size < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) take(next);
      if (chosen.size >= limit) break;
    }
  }
  const main = buildGroups([...chosen.values()]);
  const rest = [...input.primary.filter((model) => !chosen.has(model.key)), ...input.alternates];
  const more = buildGroups(rest);
  return { main, more, hasMore: more.length > 0 };
}

export function flattenBlocks(blocks: readonly GroupBlock[]): PickerModel[] {
  return blocks.flatMap((block) => block.models);
}

export function filterBlocks(blocks: readonly GroupBlock[], query: string): GroupBlock[] {
  if (query.trim().length === 0) return [...blocks];
  return blocks
    .map((block) => ({ group: block.group, models: block.models.filter((model) => matchesQuery(model, query)) }))
    .filter((block) => block.models.length > 0);
}

export function searchEverything(input: Pick<SplitInput, "primary" | "alternates">, query: string): GroupBlock[] {
  return filterBlocks(buildGroups([...input.primary, ...input.alternates]), query);
}

export function pushRecent(recents: readonly string[], key: string, max = 12): string[] {
  return [key, ...recents.filter((entry) => entry !== key)].slice(0, max);
}

export function stepIndex(current: number, delta: 1 | -1, total: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : total - 1;
  return (current + delta + total) % total;
}
