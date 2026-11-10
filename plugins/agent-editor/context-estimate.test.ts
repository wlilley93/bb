import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estimateContext, estimateTokens, stripJsonc } from "./context-estimate.js";

const dirs: string[] = [];

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "context-estimate-"));
  dirs.push(base);
  const home = path.join(base, "home");
  const opencodeDir = path.join(home, ".config", "opencode");
  const project = path.join(base, "project");
  await mkdir(path.join(opencodeDir, "skills", "audit"), { recursive: true });
  await mkdir(path.join(opencodeDir, "agents"), { recursive: true });
  await mkdir(path.join(opencodeDir, "instructions"), { recursive: true });
  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(path.join(project, "pkg"), { recursive: true });
  await writeFile(path.join(opencodeDir, "AGENTS.md"), "g".repeat(400));
  await writeFile(path.join(project, "AGENTS.md"), "p".repeat(800));
  await writeFile(path.join(project, "pkg", "CLAUDE.md"), "c".repeat(200));
  await writeFile(path.join(opencodeDir, "instructions", "extra.md"), "e".repeat(40));
  await writeFile(path.join(opencodeDir, "opencode.jsonc"), `{
  // comment with "quotes" and https://example.com
  "instructions": ["instructions/*.md"],
}
`);
  await writeFile(path.join(opencodeDir, "skills", "audit", "SKILL.md"), "---\nname: audit\ndescription: Audit the thing\n---\nbody that is never sent\n".repeat(1));
  await writeFile(path.join(opencodeDir, "agents", "worker.md"), "---\nmode: subagent\ndescription: Does a task\n---\nlong body".repeat(1));
  await writeFile(path.join(opencodeDir, "agents", "head.md"), "---\nmode: primary\ndescription: Not injected\n---\n");
  return { home, opencodeDir, project };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("estimateContext", () => {
  it("strips comments without touching urls inside strings", () => {
    expect(JSON.parse(stripJsonc('{"a": "https://x.y", // c\n "b": [1,],}'))).toEqual({ a: "https://x.y", b: [1] });
  });

  it("measures the files opencode loads and leaves the remainder as messages", async () => {
    const { home, opencodeDir, project } = await fixture();
    const result = await estimateContext({ cwd: path.join(project, "pkg"), usedTokens: 5000, windowTokens: 100000, opencodeDir, home });
    const instructions = result.categories.find((entry) => entry.id === "instructions");
    expect(instructions?.entries.map((entry) => entry.tokens)).toEqual([100, 200, 50, 10]);
    expect(result.categories.find((entry) => entry.id === "skills")?.entries).toHaveLength(1);
    expect(result.categories.find((entry) => entry.id === "agents")?.entries.map((entry) => entry.label)).toEqual(["worker"]);
    const messages = result.categories.find((entry) => entry.id === "messages");
    expect(messages?.tokens).toBe(5000 - result.measuredTokens);
    expect(result.categories.find((entry) => entry.kind === "free")?.tokens).toBe(95000);
    expect(result.estimated).toBe(true);
  });

  it("never reports a negative remainder", async () => {
    const { home, opencodeDir, project } = await fixture();
    const result = await estimateContext({ cwd: project, usedTokens: 10, windowTokens: 100, opencodeDir, home });
    expect(result.categories.find((entry) => entry.id === "messages")?.tokens).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
  });
});
