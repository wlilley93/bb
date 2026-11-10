import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface EstimateEntry {
  id: string;
  label: string;
  tokens: number;
}

export interface EstimateCategory {
  id: string;
  label: string;
  kind: "used" | "free" | "reserved" | "deferred";
  tokens: number;
  entries: EstimateEntry[];
}

export interface EstimateInput {
  cwd: string | null;
  usedTokens: number;
  windowTokens: number;
  opencodeDir: string;
  home: string;
}

export interface EstimateResult {
  estimated: true;
  measuredTokens: number;
  categories: EstimateCategory[];
  note: string;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function stripJsonc(source: string): string {
  let out = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        index += 1;
      } else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
    } else out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function frontmatterField(body: string, field: string): string {
  const match = body.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function homeLabel(file: string, home: string): string {
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

async function projectInstructionFiles(cwd: string, home: string): Promise<string[]> {
  const found: string[] = [];
  let dir = path.resolve(cwd);
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const candidate = path.join(dir, name);
      if (await exists(candidate)) {
        found.push(candidate);
        break;
      }
    }
    if (await exists(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return found.reverse();
}

async function expandInstruction(pattern: string, bases: string[], home: string): Promise<string[]> {
  const expanded = pattern.startsWith("~/") ? path.join(home, pattern.slice(2)) : pattern;
  const candidates = path.isAbsolute(expanded) ? [expanded] : bases.map((base) => path.join(base, expanded));
  const files: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.includes("*")) {
      if (await exists(candidate)) files.push(candidate);
      continue;
    }
    const dir = path.dirname(candidate);
    const matcher = new RegExp(`^${path.basename(candidate).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names.sort()) if (matcher.test(name)) files.push(path.join(dir, name));
  }
  return files;
}

async function skillEntries(dirs: string[], home: string): Promise<EstimateEntry[]> {
  const entries: EstimateEntry[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names.sort()) {
      const body = await readText(path.join(dir, name, "SKILL.md"));
      if (body === null) continue;
      const skillName = frontmatterField(body, "name") || name;
      if (seen.has(skillName)) continue;
      seen.add(skillName);
      const description = frontmatterField(body, "description");
      entries.push({
        id: `skill:${homeLabel(path.join(dir, name), home)}`,
        label: skillName,
        tokens: estimateTokens(`<skill><name>${skillName}</name><description>${description}</description></skill>`),
      });
    }
  }
  return entries;
}

async function agentEntries(dir: string): Promise<EstimateEntry[]> {
  const entries: EstimateEntry[] = [];
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const body = await readText(path.join(dir, name));
    if (body === null) continue;
    if (frontmatterField(body, "mode") === "primary") continue;
    const id = name.replace(/\.md$/, "");
    entries.push({ id: `agent:${id}`, label: id, tokens: estimateTokens(`- ${id}: ${frontmatterField(body, "description")}`) });
  }
  return entries;
}

function category(id: string, label: string, entries: EstimateEntry[]): EstimateCategory {
  return { id, label, kind: "used", tokens: entries.reduce((sum, entry) => sum + entry.tokens, 0), entries };
}

export async function estimateContext(input: EstimateInput): Promise<EstimateResult> {
  const { cwd, home, opencodeDir } = input;
  const instructionFiles: string[] = [];
  const globalAgents = path.join(opencodeDir, "AGENTS.md");
  if (await exists(globalAgents)) instructionFiles.push(globalAgents);
  else if (await exists(path.join(home, ".claude", "CLAUDE.md"))) instructionFiles.push(path.join(home, ".claude", "CLAUDE.md"));
  if (cwd !== null) instructionFiles.push(...await projectInstructionFiles(cwd, home));

  const config = await readText(path.join(opencodeDir, "opencode.jsonc")) ?? await readText(path.join(opencodeDir, "opencode.json"));
  let configured: string[] = [];
  if (config !== null) {
    try {
      const parsed: unknown = JSON.parse(stripJsonc(config));
      const list = typeof parsed === "object" && parsed !== null && "instructions" in parsed ? parsed.instructions : null;
      if (Array.isArray(list)) configured = list.filter((item): item is string => typeof item === "string");
    } catch {
      configured = [];
    }
  }
  const bases = cwd === null ? [opencodeDir] : [cwd, opencodeDir];
  for (const pattern of configured) {
    for (const file of await expandInstruction(pattern, bases, home)) {
      if (!instructionFiles.includes(file)) instructionFiles.push(file);
    }
  }

  const instructionEntries: EstimateEntry[] = [];
  for (const file of instructionFiles) {
    const body = await readText(file);
    if (body === null) continue;
    instructionEntries.push({ id: `file:${file}`, label: homeLabel(file, home), tokens: estimateTokens(body) });
  }

  const skillDirs = [
    path.join(opencodeDir, "skills"),
    path.join(home, ".claude", "skills"),
    ...(cwd === null ? [] : [path.join(cwd, ".opencode", "skills"), path.join(cwd, ".claude", "skills")]),
  ];
  const skills = await skillEntries(skillDirs, home);
  const agents = await agentEntries(path.join(opencodeDir, "agents"));

  const groups = [
    category("instructions", "Instructions (AGENTS.md and config)", instructionEntries),
    category("skills", "Skills", skills),
    category("agents", "Agent roster", agents),
  ].filter((group) => group.entries.length > 0);

  const measured = groups.reduce((sum, group) => sum + group.tokens, 0);
  const used = Math.max(0, Math.round(input.usedTokens));
  const remainder = Math.max(0, used - measured);
  const categories: EstimateCategory[] = [
    ...groups,
    { id: "messages", label: "Messages, tool output and system prompt", kind: "used", tokens: remainder, entries: [] },
    { id: "free", label: "Free space", kind: "free", tokens: Math.max(0, Math.round(input.windowTokens) - used), entries: [] },
  ];
  return {
    estimated: true,
    measuredTokens: measured,
    categories,
    note: "Estimated at about 4 characters per token from the files OpenCode loads. The provider reports a total only, so the remainder (system prompt, MCP tool schemas, messages) is not itemised.",
  };
}
