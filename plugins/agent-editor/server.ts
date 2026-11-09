import {
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { homedir } from "node:os";
import path from "node:path";
import {
  CompanyDirectoryError,
  SHARED_ROOT_FILE,
  ensureCompanyDirectory,
  listInstalledSeats,
  readSharedRoot,
  renderThenRestart,
  saveCanonDuty,
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
});

export interface AgentEditorOptions {
  layout: CompanyLayout;
}

function fail(error: unknown): never {
  throw new Error(error instanceof CompanyDirectoryError ? error.message : String(error));
}

export function registerAgentEditor(bb: BbPluginApi, options: AgentEditorOptions): void {
  const settings = bb.settings.define({
    companyRoot: {
      type: "string",
      label: "Company root",
      description: "The folder whose Agent Operations directory these editors read. It may be the copy on this server, or a SharePoint or Box folder that rsync keeps in step. There is no agent mapping step.",
    },
  });
  settings.onChange((next) => {
    const root = next.companyRoot;
    if (typeof root === "string" && root.length > 0) {
      void writeSharedRoot(root, options.layout.rootFile).catch((error: unknown) => {
        bb.log.warn(error instanceof Error ? error.message : String(error));
      });
    }
  });

  async function root(): Promise<string> {
    const shared = await readSharedRoot(options.layout.rootFile);
    if (shared) return shared;
    const fromSettings = (await settings.get()).companyRoot;
    if (typeof fromSettings === "string" && fromSettings.length > 0) return fromSettings;
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
