import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCompanyDirectory,
  folderForSeat,
  listInstalledSeats,
  listSeatFolders,
  renderThenRestart,
  addPermissionRequest,
  saveCanonDuty,
  saveCompanyFile,
  saveRole,
  saveSeatRequest,
  writeSharedRoot,
} from "./company-directory.js";
import { homeRows, liveHeadFolders, nestSeatFolders } from "./seat-folders.js";

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
  it("reads a head, VP, or PM from the file name when the profile has no tier", async () => {
    const { opencodeDir } = await layout();
    await writeFile(path.join(opencodeDir, "agents", "head-engineering.md"), "---\nmode: all\n---\n");
    await writeFile(path.join(opencodeDir, "agents", "eng-lead.md"), "---\nmode: all\ntier: seat\n---\n");
    const { seats } = await listInstalledSeats(opencodeDir);
    expect(seats.find((seat) => seat.id === "head-engineering")?.tier).toBe("head");
    expect(seats.find((seat) => seat.id === "pm")?.tier).toBe("pm");
    expect(seats.find((seat) => seat.id === "eng-lead")?.tier).toBe("seat");
  });

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

describe("folder for a seat", () => {
  it("opens the folder whose record names the seat, and a shared seat opens the head's folder", async () => {
    const rootParent = await mkdtemp(path.join(tmpdir(), "boltrig-homes-"));
    dirs.push(rootParent);
    const root = path.join(rootParent, "home");
    const personal = path.join(root, "Personal Operations");
    const travel = path.join(personal, "Travel");
    const health = path.join(personal, "Health and Wellbeing");
    const family = path.join(root, "Family Operations");
    const familyHome = path.join(family, "Home");
    const ignored = path.join(root, "node_modules", "pkg");
    await mkdir(path.join(travel, ".meta"), { recursive: true });
    await mkdir(path.join(health, ".meta"), { recursive: true });
    await mkdir(path.join(personal, ".meta"), { recursive: true });
    await mkdir(path.join(familyHome, ".meta"), { recursive: true });
    await mkdir(path.join(family, ".meta"), { recursive: true });
    await mkdir(path.join(ignored, ".meta"), { recursive: true });
    const record = (dir: string, profile: string, kind = "function.json") =>
      writeFile(path.join(dir, ".meta", kind), JSON.stringify({ agent_profile: profile }));
    await record(personal, "head-personal-ops");
    await record(travel, "vp-personal-ops");
    await record(health, "vp-personal-ops");
    await record(family, "head-family-ops");
    await record(familyHome, "vp-family-ops");
    await record(ignored, "head-personal-ops");
    const canonical = await realpath(root);
    expect(await folderForSeat(canonical, "head-personal-ops")).toEqual({
      path: await realpath(personal),
      name: "Personal Operations",
      own: true,
    });
    expect(await folderForSeat(canonical, "vp-personal-ops")).toEqual({
      path: await realpath(personal),
      name: "Personal Operations",
      own: false,
    });
    expect(await folderForSeat(canonical, "vp-family-ops")).toEqual({
      path: await realpath(familyHome),
      name: "Home",
      own: true,
    });
    expect(await folderForSeat(canonical, "head-engineering")).toBeNull();
    const listed = await listSeatFolders(canonical);
    expect(listed.map((folder) => folder.name).sort()).toEqual(
      ["Family Operations", "Health and Wellbeing", "Home", "Personal Operations", "Travel"].sort(),
    );
    expect(listed.find((folder) => folder.name === "Personal Operations")?.tier).toBe("head");
    expect(listed.find((folder) => folder.name === "Travel")?.tier).toBe("vp");
  });

  it("reads a declared tier from the home record", async () => {
    const rootParent = await mkdtemp(path.join(tmpdir(), "boltrig-homes-"));
    dirs.push(rootParent);
    const root = path.join(rootParent, "home");
    const standards = path.join(root, "Standards");
    await mkdir(path.join(standards, ".meta"), { recursive: true });
    await writeFile(path.join(standards, ".meta", "function.json"), JSON.stringify({
      agent_profile: "head-engineering",
      tier: "seat",
    }));
    const listed = await listSeatFolders(await realpath(root));
    expect(listed).toEqual([{
      path: await realpath(standards),
      name: "Standards",
      seat: "head-engineering",
      tier: "seat",
    }]);
  });

  it("stops the tree at a PM folder", () => {
    const nested = nestSeatFolders([
      { path: "/h/Projects", name: "Projects", seat: "head-projects", tier: "head" },
      { path: "/h/Projects/Boltrig", name: "Boltrig", seat: "vp-projects", tier: "vp" },
      { path: "/h/Projects/Boltrig/bb", name: "bb", seat: "pm-projects", tier: "pm" },
      { path: "/h/Projects/Boltrig/bb/worktrees", name: "worktrees", seat: "pm-projects", tier: "pm" },
      { path: "/h/Projects/liaison", name: "liaison", seat: "pm-projects", tier: "pm" },
    ], new Set(["pm-projects"]));
    expect(nested.map((folder) => folder.name)).toEqual(["Projects"]);
    expect(nested[0]?.children.map((folder) => folder.name)).toEqual(["Boltrig", "liaison"]);
    expect(nested[0]?.children[0]?.children.map((folder) => folder.name)).toEqual(["bb"]);
    expect(nested[0]?.children[0]?.children[0]?.children).toEqual([]);
  });

  it("keeps the shallower folder when a head is copied deeper", () => {
    const live = { path: "/h/Research", name: "Research", seat: "head-research", tier: "head", children: [] };
    const copy = { path: "/h/Backups/research-three-vps-20261105", name: "research-three-vps-20261105", seat: "head-research", tier: "head", children: [] };
    expect(liveHeadFolders([copy, live]).map((folder) => folder.name)).toEqual(["Research"]);
  });

  it("shows a head only when a folder record names it", () => {
    const seats = [
      { id: "head-engineering", tier: "head" },
      { id: "head-projects", tier: "head" },
      { id: "vp-projects", tier: "vp" },
    ];
    const rows = homeRows(seats, [
      { path: "/h/Engineering", name: "Engineering", seat: "head-engineering", tier: "seat" },
      { path: "/h/Projects", name: "Projects", seat: "head-projects", tier: "head" },
      { path: "/h/Projects/Boltrig", name: "Boltrig", seat: "vp-projects", tier: "vp" },
    ]);
    expect(rows.map((row) => row.folder.name)).toEqual(["Projects"]);
    expect(rows[0]?.children.map((row) => row.folder.name)).toEqual(["Boltrig"]);
  });

  it("adds an index line when a reference is saved", async () => {
    const { root, rootFile } = await layout();
    const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
    const reference = await readFile(path.join(company, "References", "terms.md"), "utf8");
    await saveCompanyFile(company, "References/terms.md", reference, "2026-11-09");
    const firm = await readFile(path.join(company, "Instructions", "firm.md"), "utf8");
    expect(firm).toContain("- `terms` — load when this reference is named.");
    expect(firm.startsWith("<!-- from: Company SOP Editor 2026-11-09 -->")).toBe(true);
  });

  it("adds a policy register row and refuses a permission header on a role", async () => {
    const { root, rootFile } = await layout();
    const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
    await addPermissionRequest(company, {
      id: "no-send",
      rule: "Nothing leaves the company without a person.",
      reason: "A person sends.",
      layer: "permission",
      gap: "none",
      owner: "head-agent-ops",
    }, "2026-11-09");
    const register = await readFile(path.join(company, "policies", "POLICY-REGISTER.md"), "utf8");
    expect(register).toContain("| no-send |");
    expect(register).not.toMatch(/^permissions:/m);
    await expect(saveCompanyFile(company, "Roles/clerk.md", "---\npermissions:\n  - action: send\n---\n\nClerk.\n", "2026-11-09"))
      .rejects.toThrow(/permission header/);
  });
});
