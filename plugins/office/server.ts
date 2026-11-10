import { createReadStream, createWriteStream, existsSync, readdirSync } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  experimental_joinHostPath as joinHostPath,
  experimental_getHostPathDirname as getHostPathDirname,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { sha256File } from "./content-hash.js";
import { CRAFT_APPS, type CraftApp } from "./craft-apps.js";

const execFileAsync = promisify(execFile);
const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const unpackRoot = path.join(homedir(), ".bb", "plugins", "office", "unpacked");
const ASSET_LEASE_TTL_MS = 60 * 60 * 1000;
const ASSET_LEASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const sourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().optional(),
  })
  .strict();

const bundleSchema = z.object({
  glue: z.string(),
  wasm: z.string(),
  worker: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  assets: {
    input: z
      .object({
        id: z.enum(["wordcraft", "deckcraft", "gridcraft", "pdfcraft"]),
      })
      .strict(),
    output: bundleSchema.extend({
      baseUrl: z.string(),
      expiresAtMs: z.number(),
    }),
  },
  write: {
    input: z
      .object({
        path: z.string().min(1),
        source: sourceSchema,
        bytesBase64: z.string(),
      })
      .strict(),
    output: z.object({ sha256: z.string() }),
  },
});

function workspacePath(rootPath: string, relativePath: string): string {
  const joined = joinHostPath({ rootPath, relativePath });
  if (joined === null) throw new Error("Workspace path must be absolute");
  return joined;
}

function bundleFiles(directory: string, app: CraftApp): {
  glue: string;
  wasmName: string;
  worker: string | null;
} {
  const names = readdirSync(directory);
  const wasmName = names.find((name) => name.includes("-web-") && name.endsWith("_bg.wasm"));
  const glueName = names.find((name) => name.endsWith(".js") && name.includes("-web-"));
  const loaderName = names.find((name) => name.endsWith("_loader.js"));
  if (wasmName === undefined || glueName === undefined) {
    throw new Error(`${app.title} web build is incomplete`);
  }
  return {
    glue: `${app.id}/${glueName}`,
    wasmName,
    worker: loaderName === undefined ? null : `./${loaderName}`,
  };
}

const gzipping = new Map<string, Promise<string>>();

async function ensureSideGzip(directory: string, appId: string): Promise<void> {
  const names = readdirSync(directory);
  const tasks: Promise<string>[] = [];
  for (const name of names) {
    if (name.endsWith("_bg.wasm") && !name.includes("-web-")) {
      tasks.push(compressedWasm(directory, name, appId));
    }
  }
  await Promise.all(tasks);
}

async function compressedWasm(directory: string, wasmName: string, appId: string): Promise<string> {
  const raw = `${appId}/${wasmName}`;
  const gzName = `${wasmName}.gz`;
  const gzPath = path.join(directory, gzName);
  const wasmPath = path.join(directory, wasmName);
  const gzStat = await stat(gzPath).catch(() => null);
  const wasmStat = await stat(wasmPath);
  if (gzStat !== null && gzStat.size > 0 && gzStat.mtimeMs >= wasmStat.mtimeMs) {
    return `${appId}/${gzName}`;
  }
  const pending = gzipping.get(gzPath);
  if (pending) return pending;
  const job = (async () => {
    const partial = `${gzPath}.partial`;
    try {
      await pipeline(createReadStream(wasmPath), createGzip({ level: 6 }), createWriteStream(partial));
      await rename(partial, gzPath);
      return `${appId}/${gzName}`;
    } catch {
      await unlink(partial).catch(() => undefined);
      return raw;
    } finally {
      gzipping.delete(gzPath);
    }
  })();
  gzipping.set(gzPath, job);
  return job;
}

async function unpackApp(app: CraftApp): Promise<void> {
  const destination = path.join(unpackRoot, app.id);
  if (existsSync(path.join(destination, "index.html"))) return;
  const zipPath = path.join(pluginDir, "vendor", "zips", app.zip);
  const hash = await sha256File(zipPath);
  if (hash !== app.sha256) {
    throw new Error(`${app.title} web build does not match the pinned release`);
  }
  await execFileAsync("python3", [
    "-c",
    `
import shutil, zipfile
from pathlib import Path
dest = Path(${JSON.stringify(destination)})
staging = dest.parent / (${JSON.stringify(app.id)} + ".extracting")
if staging.exists():
    shutil.rmtree(staging)
staging.mkdir(parents=True)
with zipfile.ZipFile(${JSON.stringify(zipPath)}) as archive:
    archive.extractall(staging)
inner = staging / ${JSON.stringify(app.innerDir)}
if dest.exists():
    shutil.rmtree(dest)
inner.rename(dest)
shutil.rmtree(staging, ignore_errors=True)
`,
  ]);
}

let preparing: Promise<void> | null = null;

async function ensureApps(): Promise<void> {
  if (CRAFT_APPS.every((app) => existsSync(path.join(unpackRoot, app.id, "index.html")))) {
    return;
  }
  preparing ??= Promise.all(CRAFT_APPS.map((app) => unpackApp(app)))
    .then(() => undefined)
    .finally(() => {
      preparing = null;
    });
  await preparing;
}

export default async function plugin(bb: BbPluginApi) {
  let assetLease: { baseUrl: string; expiresAtMs: number } | null = null;

  async function assets(id: CraftApp["id"]) {
    await ensureApps();
    const now = Date.now();
    if (
      assetLease === null ||
      assetLease.expiresAtMs - now < ASSET_LEASE_REFRESH_MARGIN_MS
    ) {
      assetLease = await bb.sdk.files.createPreview({
        rootPath: unpackRoot,
        ttlMs: ASSET_LEASE_TTL_MS,
      });
    }
    const craft = CRAFT_APPS.find((app) => app.id === id);
    if (craft === undefined) throw new Error("That office app is not available");
    const directory = path.join(unpackRoot, craft.id);
    const files = bundleFiles(directory, craft);
    const [wasm] = await Promise.all([
      compressedWasm(directory, files.wasmName, craft.id),
      ensureSideGzip(directory, craft.id),
    ]);
    return {
      ...assetLease,
      glue: files.glue,
      wasm,
      worker: files.worker,
    };
  }

  async function resolveTarget(
    source: z.infer<typeof sourceSchema>,
    filePath: string,
  ): Promise<{ path: string; rootPath: string; hostId?: string }> {
    if (source.kind === "thread-storage") {
      if (source.threadId === null) {
        throw new Error("This thread-storage file has no thread");
      }
      const { hostId, storageRootPath } = await bb.sdk.threads.storageLocation({
        threadId: source.threadId,
      });
      return {
        path: workspacePath(storageRootPath, filePath),
        rootPath: storageRootPath,
        hostId,
      };
    }
    if (source.environmentId === null && source.kind === "workspace") {
      if (source.projectId === null) {
        throw new Error("This file has no environment or project");
      }
      const project = await bb.sdk.projects.get({ projectId: source.projectId });
      const sources = project.sources;
      const checkout =
        source.experimental_hostId === undefined
          ? (sources.find((entry) => entry.isDefault) ?? sources[0])
          : sources.find((entry) => entry.hostId === source.experimental_hostId);
      if (checkout === undefined) {
        throw new Error("This project has no matching source checkout");
      }
      return {
        path: workspacePath(checkout.path, filePath),
        rootPath: checkout.path,
        hostId: checkout.hostId,
      };
    }
    if (source.kind === "host") {
      const rootPath = getHostPathDirname(filePath);
      if (rootPath === null) throw new Error("Host file paths must be absolute");
      let hostId = source.experimental_hostId;
      if (hostId === undefined && source.environmentId !== null) {
        const environment = await bb.sdk.environments.get({
          environmentId: source.environmentId,
        });
        hostId = environment.hostId ?? undefined;
      }
      return {
        path: filePath,
        rootPath,
        ...(hostId ? { hostId } : {}),
      };
    }
    if (source.environmentId === null) {
      throw new Error("This file has no environment to resolve it against");
    }
    const environment = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });
    if (!environment.path) {
      throw new Error("This environment has no workspace path");
    }
    return {
      path: workspacePath(environment.path, filePath),
      rootPath: environment.path,
      ...(environment.hostId ? { hostId: environment.hostId } : {}),
    };
  }

  bb.rpc.register(rpcContract, {
    assets: ({ id }) => assets(id),
    async write({ path: filePath, source, bytesBase64 }) {
      const target = await resolveTarget(source, filePath);
      const result = await bb.sdk.files.write({
        ...target,
        content: bytesBase64,
        contentEncoding: "base64",
        createParents: true,
      });
      if (result.outcome !== "written") {
        throw new Error("The file changed before it could be saved");
      }
      return { sha256: result.sha256 };
    },
  });
}
