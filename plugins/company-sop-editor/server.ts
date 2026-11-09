import {
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  CompanyDirectoryError,
  addPermissionRequest,
  ensureCompanyDirectory,
  listSopFiles,
  readCompanyFile,
  readSharedRoot,
  renderThenRestart,
  saveCompanyFile,
  writeSharedRoot,
} from "../agent-editor/company-directory.js";
import { defaultLayout } from "../agent-editor/server.js";

export const companySopRpc = defineRpcContract({
  getRoot: {
    input: z.null(),
    output: z.object({ root: z.string().nullable() }).strict(),
  },
  setRoot: {
    input: z.object({ root: z.string().min(1) }).strict(),
    output: z.object({ root: z.string(), companyDir: z.string(), reason: z.string() }).strict(),
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

export interface CompanySopOptions {
  layout: import("../agent-editor/company-directory.js").CompanyLayout;
  today?: string;
}

function fail(error: unknown): never {
  throw new Error(error instanceof CompanyDirectoryError ? error.message : String(error));
}

export function registerCompanySopEditor(bb: BbPluginApi, options: CompanySopOptions): void {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const settings = bb.settings.define({
    companyRoot: {
      type: "string",
      label: "Company root",
      description: "The same folder Agent Editor uses. It may be the copy on this server, or a SharePoint or Box folder that rsync keeps in step. Agent mapping is not part of this editor.",
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

  async function dir(): Promise<string> {
    const root = await readSharedRoot(options.layout.rootFile);
    if (!root) throw new CompanyDirectoryError("Choose a company root first.");
    return ensureCompanyDirectory(root, options.layout.packDir);
  }

  bb.rpc.register(companySopRpc, {
    getRoot: async () => ({ root: await readSharedRoot(options.layout.rootFile) }),
    setRoot: async ({ root }) => {
      const canonical = await writeSharedRoot(root, options.layout.rootFile).catch(fail);
      const directory = await ensureCompanyDirectory(canonical, options.layout.packDir).catch(fail);
      const rendered = await renderThenRestart({
        root: canonical,
        opencodeDir: options.layout.opencodeDir,
        packDir: options.layout.packDir,
        configPackage: options.layout.configPackage,
        restartCommand: process.env.BOLTRIG_OPENCODE_RESTART?.split(" ").filter(Boolean),
      });
      if (!rendered.ready) throw new CompanyDirectoryError(rendered.reason);
      return { root: canonical, companyDir: directory, reason: rendered.reason };
    },
    files: async () => ({ files: await listSopFiles(await dir().catch(fail)) }),
    readFile: async ({ path: relative }) => ({
      path: relative,
      body: await readCompanyFile(await dir().catch(fail), relative).catch(fail),
    }),
    saveFile: async ({ path: relative, body }) => {
      await saveCompanyFile(await dir().catch(fail), relative, body, today).catch(fail);
      return { path: relative };
    },
    addPermission: async (row) => {
      await addPermissionRequest(await dir().catch(fail), row, today).catch(fail);
      return { path: "policies/POLICY-REGISTER.md" };
    },
  });
}

export default function companySopEditorPlugin(bb: BbPluginApi): void {
  registerCompanySopEditor(bb, { layout: defaultLayout() });
}
