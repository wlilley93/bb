import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface VisionAnswer {
  image: boolean | null;
  source: "known-rejection" | "catalog" | "unknown";
}

type VisionMap = Record<string, boolean>;

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const KNOWN_REJECTIONS = new Set(["glm53flashfree"]);

export function normalizeModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

export function visionMapFromCatalog(catalog: unknown): VisionMap {
  const map: VisionMap = {};
  if (typeof catalog !== "object" || catalog === null) return map;
  for (const provider of Object.values(catalog)) {
    if (typeof provider !== "object" || provider === null) continue;
    const models: unknown = Reflect.get(provider, "models");
    if (typeof models !== "object" || models === null) continue;
    for (const model of Object.values(models)) {
      if (typeof model !== "object" || model === null) continue;
      const name: unknown = Reflect.get(model, "name");
      const modalities: unknown = Reflect.get(model, "modalities");
      const input = typeof modalities === "object" && modalities !== null ? Reflect.get(modalities, "input") : null;
      if (typeof name !== "string" || !Array.isArray(input)) continue;
      const key = normalizeModelName(name);
      map[key] = (map[key] ?? false) || input.includes("image");
    }
  }
  return map;
}

export function answerVision(map: VisionMap, displayName: string): VisionAnswer {
  const key = normalizeModelName(displayName);
  if (KNOWN_REJECTIONS.has(key)) return { image: false, source: "known-rejection" };
  const image = map[key];
  return image === undefined ? { image: null, source: "unknown" } : { image, source: "catalog" };
}

async function readCache(file: string): Promise<VisionMap | null> {
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > CACHE_MAX_AGE_MS) return null;
    return JSON.parse(await readFile(file, "utf8")) as VisionMap;
  } catch {
    return null;
  }
}

let memory: { map: VisionMap; loadedAt: number } | null = null;

export async function loadVisionMap(cacheFile: string, fetchCatalog: () => Promise<unknown> = defaultFetch): Promise<VisionMap> {
  if (memory !== null && Date.now() - memory.loadedAt < CACHE_MAX_AGE_MS) return memory.map;
  const cached = await readCache(cacheFile);
  if (cached !== null) {
    memory = { map: cached, loadedAt: Date.now() };
    return cached;
  }
  try {
    const map = visionMapFromCatalog(await fetchCatalog());
    if (Object.keys(map).length > 0) {
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, JSON.stringify(map));
      memory = { map, loadedAt: Date.now() };
    }
    return map;
  } catch {
    return {};
  }
}

async function defaultFetch(): Promise<unknown> {
  const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}.`);
  return response.json();
}

export function resetVisionMemory() {
  memory = null;
}
