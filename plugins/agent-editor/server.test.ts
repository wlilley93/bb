import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCompanyDirectory,
  renderThenRestart,
  saveCanonDuty,
  saveRole,
  saveSeatRequest,
  writeSharedRoot,
} from "./company-directory.js";

const packDir = path.join(import.meta.dirname, "..", "..", "..", "..", "boltrig-opencode-company-SOP");
const configPackage = path.join(import.meta.dirname, "..", "..", "..", "..", "boltrig-opencode-config");
const dirs: string[] = [];

async function layout() {
  const rootParent = await mkdtemp(path.join(tmpdir(), "boltrig-agent-editor-"));
  dirs.push(rootParent);
  const root = path.join(rootParent, "company");
  const opencodeDir = path.join(rootParent, "opencode");
  const rootFile = path.join(rootParent, "company-root.json");
  await mkdir(root);
  await mkdir(path.join(opencodeDir, "agents"), { recursive: true });
  await writeFile(path.join(opencodeDir, "boltrig-doctrine.md"), "Doctrine text.\n");
  await writeFile(path.join(opencodeDir, "agents", "pm.md"), `---
mode: primary
tier: pm
rank: peer
permissions:
  - action: subagent
    effect: deny
---

## Reach

One up, lateral, one down.
`);
  return { root, opencodeDir, rootFile };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent editor", () => {
  it("creates Agent Operations from the blank pack and leaves the OpenCode config untouched", async () => {
    const { root, opencodeDir, rootFile } = await layout();
    const before = await readFile(path.join(opencodeDir, "agents", "pm.md"), "utf8");
    const canonical = await writeSharedRoot(root, rootFile);
    const company = await ensureCompanyDirectory(canonical, packDir);
    expect(canonical).toBe(await realpath(root));
    expect(await readFile(path.join(company, "Instructions", "firm.md"), "utf8")).toContain("how this company works");
    expect(await readFile(path.join(opencodeDir, "agents", "pm.md"), "utf8")).toBe(before);
  });

  it("saves a canon duty as seat id and does not write scaffolding", async () => {
    const { root, opencodeDir, rootFile } = await layout();
    const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
    await saveCanonDuty(company, "pm", "The company asks this PM to keep the record.", opencodeDir);
    const duty = await readFile(path.join(company, "Duties", "pm.md"), "utf8");
    expect(duty).toContain("seat: pm");
    expect(duty).toContain("The company asks this PM to keep the record.");
    expect(duty).not.toMatch(/^mode:/m);
    expect(duty).not.toMatch(/^permissions:/m);
    expect(await readFile(path.join(opencodeDir, "agents", "pm.md"), "utf8")).toContain("mode: primary");
  });

  it("records a non-canon seat as a request and writes no profile", async () => {
    const { root, opencodeDir, rootFile } = await layout();
    const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
    await saveSeatRequest(company, "vp", "vp-records", "A VP the canon does not ship.", opencodeDir);
    const request = await readFile(path.join(company, "Roles", "vp-records.md"), "utf8");
    expect(request).toContain("base: vp");
    expect(request).toContain("id: vp-records");
    await expect(readFile(path.join(opencodeDir, "agents", "vp-records.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves a role as a subagent or a primary a person opens", async () => {
    const { root, opencodeDir, rootFile } = await layout();
    const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
    await saveRole(company, packDir, "clerk", "subagent", "Files the record.", opencodeDir);
    await saveRole(company, packDir, "desk", "primary", "A person opens this.", opencodeDir);
    expect(await readFile(path.join(company, "Roles", "clerk.md"), "utf8")).toContain("base: subagent");
    expect(await readFile(path.join(company, "Roles", "desk.md"), "utf8")).toContain("base: primary");
    expect(await readFile(path.join(company, "Roles", "clerk.md"), "utf8")).not.toMatch(/^permissions:/m);
    await expect(readFile(path.join(opencodeDir, "agents", "clerk.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders a duty into the OpenCode config and leaves a non-subagent role uninstalled", async () => {
    const { root, opencodeDir, rootFile } = await layout();
    await rm(path.join(opencodeDir, "agents", "pm.md"));
    const canonical = await writeSharedRoot(root, rootFile);
    const company = await ensureCompanyDirectory(canonical, packDir);
    const installed = await renderThenRestart({
      root: canonical,
      opencodeDir,
      packDir,
      configPackage,
    });
    expect(installed.ready).toBe(true);
    await saveCanonDuty(company, "pm", "The company asks this PM to keep the record.", opencodeDir);
    await saveSeatRequest(company, "vp", "vp-records", "A VP the canon does not ship.", opencodeDir);
    await saveRole(company, packDir, "clerk", "subagent", "Files the record.", opencodeDir);
    await saveRole(company, packDir, "desk", "primary", "A person opens this.", opencodeDir);
    await rm(path.join(opencodeDir, "agents", "pm.md"));
    const result = await renderThenRestart({
      root: canonical,
      opencodeDir,
      packDir,
      configPackage,
    });
    expect(result.ready).toBe(true);
    expect(result.restarted).toBe(false);
    const profile = await readFile(path.join(opencodeDir, "agents", "pm.md"), "utf8");
    expect(profile).toContain("The company asks this PM to keep the record.");
    expect(await readFile(path.join(opencodeDir, "agents", "clerk.md"), "utf8")).toContain("Files the record.");
    await expect(readFile(path.join(opencodeDir, "agents", "vp-records.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(opencodeDir, "agents", "desk.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.reason).toContain("vp vp-records");
    expect(result.reason).toContain("primary desk");
  });
});
