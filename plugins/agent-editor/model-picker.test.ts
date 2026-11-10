import { describe, expect, it } from "vitest";
import {
  buildGroups,
  compareVersionDesc,
  dedupeAcrossRuntimes,
  filterBlocks,
  flattenBlocks,
  groupForName,
  matchesQuery,
  normalizeName,
  pushRecent,
  resolveGroup,
  searchEverything,
  sortNewestFirst,
  splitMainAndMore,
  stepIndex,
  toPickerModel,
  versionVector,
  type PickerModel,
  type RuntimeInfo,
} from "./model-picker-logic.js";

const codex: RuntimeInfo = { id: "codex", label: "Codex", logoUrl: "/codex.svg" };
const claude: RuntimeInfo = { id: "claude-code", label: "Claude Code", logoUrl: "/claude.svg" };
const cursor: RuntimeInfo = { id: "acp-cursor", label: "Cursor", logoUrl: "/cursor.svg" };
const opencode: RuntimeInfo = { id: "acp-opencode", label: "opencode", logoUrl: "/oc.svg" };

function model(runtime: RuntimeInfo, value: string, label: string, route?: string): PickerModel {
  return toPickerModel(runtime, { value, label, routeProviderId: route });
}

describe("groups", () => {
  it("maps runtimes and routes to provider groups", () => {
    expect(resolveGroup("codex", "Codex", "GPT-6", undefined)).toBe("OpenAI");
    expect(resolveGroup("claude-code", "Claude Code", "Opus 5.5", undefined)).toBe("Anthropic");
    expect(resolveGroup("acp-opencode", "opencode", "GPT OSS 120B", "cerebras")).toBe("Cerebras");
    expect(resolveGroup("acp-opencode", "opencode", "Fable 5.1", "claude-agent")).toBe("Anthropic");
    expect(resolveGroup("acp-opencode", "opencode", "Kimi K3", "kimi-code-plan-global")).toBe("Kimi");
    expect(resolveGroup("pi", "Pi", "DeepSeek V4 Pro", "deepseek")).toBe("DeepSeek");
    expect(resolveGroup("acp-opencode", "opencode", "Model", "some-new-route")).toBe("Some New Route");
  });

  it("splits cursor models by what they are", () => {
    expect(resolveGroup("acp-cursor", "Cursor", "Claude Opus 5", undefined)).toBe("Anthropic");
    expect(resolveGroup("acp-cursor", "Cursor", "GPT-5.6 Sol", undefined)).toBe("OpenAI");
    expect(resolveGroup("acp-cursor", "Cursor", "Composer 2.5", undefined)).toBe("Cursor");
    expect(resolveGroup("acp-cursor", "Cursor", "Auto", undefined)).toBe("Cursor");
    expect(groupForName("Grok 4.6")).toBe("xAI");
  });

  it("orders groups with known providers first and Other last", () => {
    const blocks = buildGroups([
      model(opencode, "z/a", "Zed", "zai"),
      model(codex, "gpt-6", "GPT-6"),
      model(opencode, "c/a", "Alpha", "cerebras"),
      model(claude, "opus", "Opus 5"),
    ]);
    expect(blocks.map((block) => block.group)).toEqual(["OpenAI", "Anthropic", "Cerebras", "Z.ai"]);
  });
});

describe("sorting", () => {
  it("reads version vectors and ignores date stamps", () => {
    expect(versionVector("Opus 5.5")).toEqual([5, 5]);
    expect(versionVector("GPT-6.1-Sol")).toEqual([6, 1]);
    expect(versionVector("Haiku 4.5 20251001")).toEqual([4, 5]);
    expect(versionVector("Auto")).toEqual([]);
  });

  it("sorts newest first and keeps catalog order for ties", () => {
    const labels = ["Opus 4.8", "Opus 5", "Sonnet 5.5", "Haiku 5.5", "Fable 5.2", "Opus 5.5"].map((label) => ({ label }));
    expect(sortNewestFirst(labels).map((entry) => entry.label)).toEqual([
      "Sonnet 5.5",
      "Haiku 5.5",
      "Opus 5.5",
      "Fable 5.2",
      "Opus 5",
      "Opus 4.8",
    ]);
    expect(compareVersionDesc("GPT-6.1 Sol", "GPT-6 Astra")).toBeLessThan(0);
    expect(compareVersionDesc("GPT-5.6 Sol", "GPT-6 Astra")).toBeGreaterThan(0);
  });

  it("sorts unversioned labels after versioned ones", () => {
    const sorted = sortNewestFirst([{ label: "Auto" }, { label: "Composer 2.5" }]);
    expect(sorted.map((entry) => entry.label)).toEqual(["Composer 2.5", "Auto"]);
  });
});

describe("dedupe across runtimes", () => {
  const all = [
    model(claude, "claude-opus-5-5", "Opus 5.5"),
    model(opencode, "claude-agent/opus", "Opus 5.5", "claude-agent"),
    model(cursor, "claude-opus-5", "Claude Opus 5"),
    model(claude, "claude-opus-5", "Opus 5"),
    model(codex, "gpt-5.6-sol", "GPT-5.6-Sol"),
    model(opencode, "openai/gpt-5.6-sol", "GPT 5.6 Sol", "openai"),
    model(opencode, "openai/gpt-5.6-sol-fast", "GPT 5.6 Sol Fast", "openai"),
  ];

  it("normalises display names", () => {
    expect(normalizeName("Claude Opus 5")).toBe("opus5");
    expect(normalizeName("GPT-5.6-Sol")).toBe(normalizeName("GPT 5.6 Sol"));
    expect(normalizeName("Haiku 4.5 (20251001)")).toBe("haiku45");
  });

  it("keeps the native runtime and moves the rest to alternates", () => {
    const { primary, alternates } = dedupeAcrossRuntimes(all, null);
    expect(primary.map((entry) => entry.key).sort()).toEqual(
      ["claude-code::claude-opus-5", "claude-code::claude-opus-5-5", "codex::gpt-5.6-sol", "acp-opencode::openai/gpt-5.6-sol-fast"].sort(),
    );
    expect(alternates.map((entry) => entry.key).sort()).toEqual(
      ["acp-cursor::claude-opus-5", "acp-opencode::claude-agent/opus", "acp-opencode::openai/gpt-5.6-sol"].sort(),
    );
  });

  it("prefers the selected row over the native runtime", () => {
    const { primary } = dedupeAcrossRuntimes(all, "acp-opencode::claude-agent/opus");
    expect(primary.some((entry) => entry.key === "acp-opencode::claude-agent/opus")).toBe(true);
    expect(primary.some((entry) => entry.key === "claude-code::claude-opus-5-5")).toBe(false);
  });
});

describe("search", () => {
  const models = [
    model(codex, "gpt-6", "GPT-6 Astra"),
    model(claude, "opus", "Opus 5.5"),
    model(opencode, "cerebras/gpt-oss-120b", "GPT OSS 120B", "cerebras"),
  ];

  it("matches label, group, runtime and route across words", () => {
    expect(matchesQuery(models[0], "astra")).toBe(true);
    expect(matchesQuery(models[2], "cerebras oss")).toBe(true);
    expect(matchesQuery(models[1], "anthropic")).toBe(true);
    expect(matchesQuery(models[1], "gpt")).toBe(false);
    expect(matchesQuery(models[0], "gpt6")).toBe(true);
  });

  it("hides empty groups", () => {
    const blocks = filterBlocks(buildGroups(models), "gpt");
    expect(blocks.map((block) => block.group)).toEqual(["OpenAI", "Cerebras"]);
    expect(filterBlocks(buildGroups(models), "nonsense")).toEqual([]);
  });

  it("searches alternates too", () => {
    const alt = model(opencode, "claude-agent/opus", "Opus 5.5", "claude-agent");
    const blocks = searchEverything({ primary: [models[1]], alternates: [alt] }, "opus");
    expect(flattenBlocks(blocks).map((entry) => entry.key)).toEqual(["claude-code::opus", "acp-opencode::claude-agent/opus"]);
  });
});

describe("more models split", () => {
  const many: PickerModel[] = [];
  for (let i = 0; i < 9; i += 1) many.push(model(codex, `gpt-${i}`, `GPT-${i + 1}`));
  for (let i = 0; i < 8; i += 1) many.push(model(claude, `opus-${i}`, `Opus ${i + 1}`));
  for (let i = 0; i < 4; i += 1) many.push(model(opencode, `cerebras/m${i}`, `Cerebras ${i + 1}`, "cerebras"));

  it("keeps a short list in one scrollable list", () => {
    const result = splitMainAndMore({ primary: many.slice(0, 5), alternates: [], recents: [], currentKey: null });
    expect(result.hasMore).toBe(false);
    expect(flattenBlocks(result.main)).toHaveLength(5);
  });

  it("shows six models in the main list and the rest in the flyout", () => {
    const result = splitMainAndMore({ primary: many, alternates: [], recents: [], currentKey: null });
    expect(flattenBlocks(result.main)).toHaveLength(6);
    expect(flattenBlocks(result.more)).toHaveLength(many.length - 6);
    expect(result.hasMore).toBe(true);
    const keys = new Set([...flattenBlocks(result.main), ...flattenBlocks(result.more)].map((entry) => entry.key));
    expect(keys.size).toBe(many.length);
  });

  it("spreads the main list across groups newest first", () => {
    const result = splitMainAndMore({ primary: many, alternates: [], recents: [], currentKey: null });
    expect(result.main.map((block) => block.group)).toEqual(["OpenAI", "Anthropic", "Cerebras"]);
    expect(result.main[0].models[0].label).toBe("GPT-9");
    expect(result.main[1].models[0].label).toBe("Opus 8");
  });

  it("always features the current model and recents first", () => {
    const current = many.find((entry) => entry.value === "gpt-0")!;
    const recent = many.find((entry) => entry.value === "opus-2")!;
    const result = splitMainAndMore({
      primary: many,
      alternates: [],
      recents: [recent.key],
      currentKey: current.key,
    });
    const main = flattenBlocks(result.main).map((entry) => entry.key);
    expect(main).toContain(current.key);
    expect(main).toContain(recent.key);
    expect(main).toHaveLength(6);
  });

  it("sends alternates to the flyout", () => {
    const alt = model(opencode, "claude-agent/opus", "Opus 5.5", "claude-agent");
    const result = splitMainAndMore({ primary: many, alternates: [alt], recents: [], currentKey: null });
    expect(flattenBlocks(result.more).some((entry) => entry.key === alt.key)).toBe(true);
    expect(flattenBlocks(result.main).some((entry) => entry.key === alt.key)).toBe(false);
  });
});

describe("helpers", () => {
  it("records recents most recent first without duplicates", () => {
    expect(pushRecent(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(pushRecent(["a"], "c", 2)).toEqual(["c", "a"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });

  it("steps through a list with wraparound", () => {
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});
