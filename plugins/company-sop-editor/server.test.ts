import { mkdir, readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addPermissionRequest,
  ensureCompanyDirectory,
  saveCompanyFile,
  writeSharedRoot,
} from "../agent-editor/company-directory.js";

const packDir = path.join(import.meta.dirname, "..", "..", "..", "..", "boltrig-opencode-company-SOP");
const dirs: string[] = [];

async function layout() {
  const rootParent = await mkdtemp(path.join(tmpdir(), "boltrig-sop-editor-"));
  dirs.push(rootParent);
  const root = path.join(rootParent, "company");
  await mkdir(root);
  const rootFile = path.join(rootParent, "company-root.json");
  const company = await ensureCompanyDirectory(await writeSharedRoot(root, rootFile), packDir);
  return { company };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("company SOP editor", () => {
  it("adds an index line when a reference is saved", async () => {
    const { company } = await layout();
    const reference = await readFile(path.join(company, "References", "terms.md"), "utf8");
    await saveCompanyFile(company, "References/terms.md", reference, "2026-11-09");
    const firm = await readFile(path.join(company, "Instructions", "firm.md"), "utf8");
    expect(firm).toContain("- `terms` — load when this reference is named.");
    expect(firm.startsWith("<!-- from: Company SOP Editor 2026-11-09 -->")).toBe(true);
  });

  it("adds a policy register row and refuses a permission header on a role", async () => {
    const { company } = await layout();
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
