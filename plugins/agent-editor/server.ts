import {
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { estimateContext } from "./context-estimate.js";
import { answerVision, loadVisionMap } from "./model-vision.js";
import { homedir } from "node:os";
import path from "node:path";
import {
  CompanyDirectoryError,
  SHARED_ROOT_FILE,
  companyDir,
  ensureCompanyDirectory,
  addPermissionRequest,
  folderForSeat,
  listInstalledSeats,
  listSeatFolders,
  listSopFiles,
  readCanonDuty,
  readCompanyFile,
  readSharedRoot,
  renderThenRestart,
  saveCanonDuty,
  saveCompanyFile,
  saveRole,
  saveSeatRequest,
  writeSharedRoot,
  type CompanyLayout,
} from "./company-directory.js";

const layoutInput = z.object({ root: z.string().min(1) }).strict();

export const agentEditorRpc = defineRpcContract({
  getRoot: {
    input: z.null(),
    output: z.object({ root: z.string().nullable() }).strict(),
  },
  setRoot: {
    input: layoutInput,
    output: z.object({ root: z.string(), companyDir: z.string(), reason: z.string() }).strict(),
  },
  home: {
    input: z.object({ seat: z.string() }).strict(),
    output: z.object({ path: z.string().nullable(), name: z.string().nullable(), own: z.boolean() }).strict(),
  },
  folders: {
    input: z.null(),
    output: z.object({
      folders: z.array(z.object({ path: z.string(), name: z.string(), seat: z.string(), tier: z.string() }).strict()),
      company: z.string(),
    }).strict(),
  },
  seats: {
    input: z.null(),
    output: z.object({
      doctrine: z.string(),
      seats: z.array(z.object({
        id: z.string(),
        mode: z.string(),
        tier: z.string(),
        rank: z.string(),
        permissions: z.string(),
        reach: z.string(),
      }).strict()),
    }).strict(),
  },
  readDuty: {
    input: z.object({ seat: z.string() }).strict(),
    output: z.object({ body: z.string() }).strict(),
  },
  saveDuty: {
    input: z.object({ seat: z.string(), body: z.string() }).strict(),
    output: z.object({ file: z.string() }).strict(),
  },
  saveRequest: {
    input: z.object({ base: z.enum(["head", "vp", "pm"]), id: z.string(), body: z.string() }).strict(),
    output: z.object({ file: z.string() }).strict(),
  },
  saveRole: {
    input: z.object({ id: z.string(), base: z.enum(["subagent", "primary"]), body: z.string() }).strict(),
    output: z.object({ file: z.string() }).strict(),
  },
  renderThenRestart: {
    input: z.null(),
    output: z.object({ ready: z.boolean(), restarted: z.boolean(), reason: z.string() }).strict(),
  },
  files: {
    input: z.null(),
    output: z.object({
      files: z.array(z.object({ path: z.string(), title: z.string() }).strict()),
    }).strict(),
  },
  readFile: {
    input: z.object({ path: z.string() }).strict(),
    output: z.object({ path: z.string(), body: z.string() }).strict(),
  },
  saveFile: {
    input: z.object({ path: z.string(), body: z.string() }).strict(),
    output: z.object({ path: z.string() }).strict(),
  },
  estimateContext: {
    input: z.object({
      cwd: z.string().nullable(),
      usedTokens: z.number().nonnegative(),
      windowTokens: z.number().nonnegative(),
    }).strict(),
    output: z.object({
      estimated: z.literal(true),
      measuredTokens: z.number(),
      note: z.string(),
      categories: z.array(z.object({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["used", "free", "reserved", "deferred"]),
        tokens: z.number(),
        entries: z.array(z.object({ id: z.string(), label: z.string(), tokens: z.number() }).strict()),
      }).strict()),
    }).strict(),
  },
  modelVision: {
    input: z.object({ displayName: z.string().min(1) }).strict(),
    output: z.object({
      image: z.boolean().nullable(),
      source: z.enum(["known-rejection", "catalog", "unknown"]),
    }).strict(),
  },
  addPermission: {
    input: z.object({
      id: z.string(),
      rule: z.string(),
      reason: z.string(),
      layer: z.string(),
      gap: z.string(),
      owner: z.string(),
    }).strict(),
    output: z.object({ path: z.string() }).strict(),
  },
});

export interface AgentEditorOptions {
  layout: CompanyLayout;
}

function fail(error: unknown): never {
  throw new Error(error instanceof CompanyDirectoryError ? error.message : String(error));
}

export function registerAgentEditor(bb: BbPluginApi, options: AgentEditorOptions): void {
  const today = new Date().toISOString().slice(0, 10);

  async function root(): Promise<string> {
    const shared = await readSharedRoot(options.layout.rootFile);
    if (shared) return shared;
    throw new CompanyDirectoryError("Choose a company root first.");
  }

  bb.rpc.register(agentEditorRpc, {
    getRoot: async () => ({ root: await readSharedRoot(options.layout.rootFile) }),
    setRoot: async ({ root: chosen }) => {
      const canonical = await writeSharedRoot(chosen, options.layout.rootFile).catch(fail);
      const companyDir = await ensureCompanyDirectory(canonical, options.layout.packDir).catch(fail);
      const rendered = await renderThenRestart({
        root: canonical,
        opencodeDir: options.layout.opencodeDir,
        packDir: options.layout.packDir,
        configPackage: options.layout.configPackage,
        restartCommand: process.env.BOLTRIG_OPENCODE_RESTART?.split(" ").filter(Boolean),
      });
      if (!rendered.ready) throw new CompanyDirectoryError(rendered.reason);
      return { root: canonical, companyDir, reason: rendered.reason };
    },
    readDuty: async ({ seat }) => {
      const shared = await readSharedRoot(options.layout.rootFile);
      if (!shared) return { body: "" };
      const dir = await ensureCompanyDirectory(shared, options.layout.packDir).catch(fail);
      return { body: await readCanonDuty(dir, seat).catch(fail) };
    },
    home: async ({ seat }) => {
      const shared = await readSharedRoot(options.layout.rootFile);
      const folder = shared ? await folderForSeat(shared, seat).catch(() => null) : null;
      return { path: folder?.path ?? null, name: folder?.name ?? null, own: folder?.own ?? false };
    },
    folders: async () => {
      const shared = await readSharedRoot(options.layout.rootFile);
      const folders = shared ? await listSeatFolders(shared).catch(() => []) : [];
      const company = shared ? path.basename(companyDir(shared)) : "";
      return { folders, company };
    },
    seats: async () => listInstalledSeats(options.layout.opencodeDir),
    saveDuty: async ({ seat, body }) => {
      const dir = await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail);
      return { file: await saveCanonDuty(dir, seat, body, options.layout.opencodeDir).catch(fail) };
    },
    saveRequest: async ({ base, id, body }) => {
      const dir = await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail);
      return { file: await saveSeatRequest(dir, base, id, body, options.layout.opencodeDir).catch(fail) };
    },
    saveRole: async ({ id, base, body }) => {
      const dir = await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail);
      return { file: await saveRole(dir, options.layout.packDir, id, base, body, options.layout.opencodeDir).catch(fail) };
    },
    renderThenRestart: async () => {
      const root = await readSharedRoot(options.layout.rootFile);
      if (!root) throw new CompanyDirectoryError("Choose a company root first.");
      return renderThenRestart({
        root,
        opencodeDir: options.layout.opencodeDir,
        packDir: options.layout.packDir,
        configPackage: options.layout.configPackage,
        restartCommand: process.env.BOLTRIG_OPENCODE_RESTART?.split(" ").filter(Boolean),
      });
    },
    files: async () => ({ files: await listSopFiles(await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail)) }),
    readFile: async ({ path: relative }) => ({
      path: relative,
      body: await readCompanyFile(await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail), relative).catch(fail),
    }),
    saveFile: async ({ path: relative, body }) => {
      await saveCompanyFile(await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail), relative, body, today).catch(fail);
      return { path: relative };
    },
    estimateContext: async ({ cwd, usedTokens, windowTokens }) => estimateContext({
      cwd,
      usedTokens,
      windowTokens,
      opencodeDir: options.layout.opencodeDir,
      home: homedir(),
    }),
    modelVision: async ({ displayName }) => answerVision(
      await loadVisionMap(path.join(homedir(), ".cache", "boltrig", "model-vision.json")),
      displayName,
    ),
    addPermission: async (row) => {
      await addPermissionRequest(await ensureCompanyDirectory(await root(), options.layout.packDir).catch(fail), row, today).catch(fail);
      return { path: "policies/POLICY-REGISTER.md" };
    },
  });
}

export function defaultLayout(): CompanyLayout {
  return {
    rootFile: SHARED_ROOT_FILE,
    packDir: process.env.BOLTRIG_SOP_PACK
      ?? path.join(homedir(), "Projects", "Boltrig", "boltrig-opencode-company-SOP"),
    opencodeDir: process.env.OPENCODE_CONFIG_DIR
      ?? path.join(homedir(), ".config", "opencode"),
    configPackage: process.env.BOLTRIG_OPENCODE_CONFIG
      ?? path.join(homedir(), "Projects", "Boltrig", "boltrig-opencode-config"),
  };
}

export default function agentEditorPlugin(bb: BbPluginApi): void {
  registerAgentEditor(bb, { layout: defaultLayout() });
}
