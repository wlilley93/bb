const CACHE_NAME = "boltrig-craft-web";
const WASM_TYPE = "application/wasm";
const REPORT_EVERY_BYTES = 512 * 1024;
const MODULE_HOLD_MS = 2 * 60 * 1000;
function relativeImports(): RegExp {
  return /from(\s*)(['"])(\.[^'"]+)\2/g;
}

export interface LoadProgress {
  phase: "download" | "start";
  loaded: number;
  total: number | null;
}

interface CraftJob {
  promise: Promise<WebAssembly.Module>;
  last: LoadProgress | null;
  listeners: Set<(progress: LoadProgress) => void>;
  users: number;
  ready: boolean;
  abort: AbortController;
}

export interface CraftModuleHandle {
  promise: Promise<WebAssembly.Module>;
  release: () => void;
}

const jobs = new Map<string, CraftJob>();
const idleDrops = new Map<string, ReturnType<typeof setTimeout>>();
const glueUrls = new Map<string, Promise<string>>();

export function craftCacheKey(wasmUrl: string): string {
  const name = new URL(wasmUrl, "https://boltrig-craft.local").pathname.split("/").pop();
  return `https://boltrig-craft.local/${name && name.length > 0 ? name : "app.wasm"}`;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function loadLabel(title: string, progress: LoadProgress | null): string {
  if (progress === null) return `Loading ${title}…`;
  if (progress.phase === "start") return `Starting ${title}…`;
  if (progress.total === null) return `Loading ${title}… ${formatMegabytes(progress.loaded)}`;
  return `Loading ${title}… ${formatMegabytes(progress.loaded)} of ${formatMegabytes(progress.total)}`;
}

export function rewriteGlueImports(source: string, resolve: (spec: string) => string): string {
  return source.replace(relativeImports(), (_full, space: string, quote: string, spec: string) => {
    return `from${space}${quote}${resolve(spec)}${quote}`;
  });
}

export function loadPercent(progress: LoadProgress | null): number | null {
  if (progress === null || progress.total === null || progress.total <= 0) return null;
  if (progress.phase === "start") return null;
  return Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)));
}

function isCompilePulse(progress: LoadProgress): boolean {
  return progress.phase === "start" && progress.loaded === 1 && progress.total === 1;
}

export function createProgressGate(
  report: (progress: LoadProgress | null) => void,
  schedule: (run: () => void) => () => void,
): { push: (progress: LoadProgress | null) => void; cancel: () => void } {
  let pending: LoadProgress | null = null;
  let scheduled = false;
  let stopped = false;
  let cancelScheduled = () => {};
  return {
    push(progress) {
      if (stopped) return;
      pending = progress;
      if (scheduled) return;
      scheduled = true;
      cancelScheduled = schedule(() => {
        scheduled = false;
        if (stopped) return;
        report(pending);
      });
    },
    cancel() {
      stopped = true;
      cancelScheduled();
    },
  };
}

export function combineLoadProgress(
  wasm: LoadProgress | null,
  file: LoadProgress | null,
): LoadProgress | null {
  if (wasm === null && file === null) return null;
  const parts = [wasm, file].filter((part): part is LoadProgress => part !== null);
  if (parts.every((part) => part.phase === "start")) {
    return { phase: "start", loaded: 1, total: 1 };
  }
  let loaded = 0;
  let total = 0;
  let known = true;
  for (const part of parts) {
    if (isCompilePulse(part)) continue;
    loaded += part.phase === "start" ? (part.total ?? part.loaded) : part.loaded;
    if (part.total === null) known = false;
    else total += part.total;
  }
  return { phase: "download", loaded, total: known && total > 0 ? total : null };
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function gzipEncoded(wasmUrl: string): boolean {
  return wasmUrl.endsWith(".gz");
}

function asWasm(body: ReadableStream<Uint8Array>, gzipped: boolean): Response {
  const stream = gzipped ? body.pipeThrough(new DecompressionStream("gzip")) : body;
  return new Response(stream, { headers: { "content-type": WASM_TYPE } });
}

function wireResponse(body: BodyInit, gzipped: boolean): Response {
  return new Response(body, {
    headers: { "content-type": gzipped ? "application/gzip" : WASM_TYPE },
  });
}

async function compileFromNetwork(
  wasmUrl: string,
  key: string,
  report: (progress: LoadProgress) => void,
  signal: AbortSignal,
): Promise<WebAssembly.Module> {
  const response = await fetch(wasmUrl, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`The app download failed with status ${response.status}.`);
  }
  const header = Number(response.headers.get("content-length"));
  const total = Number.isFinite(header) && header > 0 ? header : null;
  const gzipped = gzipEncoded(wasmUrl);
  const body = response.body;
  if (body === null) {
    const bytes = await response.arrayBuffer();
    report({ phase: "start", loaded: bytes.byteLength, total: bytes.byteLength });
    const cache = await openCache();
    if (cache !== null) await cache.put(key, wireResponse(bytes, gzipped));
    return WebAssembly.compileStreaming(asWasm(new Blob([bytes]).stream(), gzipped));
  }

  let loaded = 0;
  let reported = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        if (reported === 0 || loaded - reported >= REPORT_EVERY_BYTES) {
          reported = loaded;
          report({ phase: "download", loaded, total });
        }
        controller.enqueue(chunk);
      },
      flush() {
        report({ phase: "start", loaded, total: total ?? (loaded > 0 ? loaded : null) });
      },
    }),
  );

  const cache = await openCache();
  if (cache === null) return WebAssembly.compileStreaming(asWasm(counted, gzipped));

  const [forCompile, forCache] = counted.tee();
  const compiled = WebAssembly.compileStreaming(asWasm(forCompile, gzipped));
  const stored = cache.put(key, wireResponse(forCache, gzipped));
  try {
    const module = await compiled;
    await stored.catch(async () => {
      await cache.delete(key).catch(() => undefined);
    });
    return module;
  } catch (error) {
    await stored.catch(() => undefined);
    await cache.delete(key).catch(() => undefined);
    throw error;
  }
}

function cancelIdleDrop(key: string) {
  const timer = idleDrops.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  idleDrops.delete(key);
}

function scheduleIdleDrop(key: string, job: CraftJob) {
  cancelIdleDrop(key);
  const timer = setTimeout(() => {
    idleDrops.delete(key);
    if (jobs.get(key) === job && job.users === 0) jobs.delete(key);
  }, MODULE_HOLD_MS);
  idleDrops.set(key, timer);
}

function attach(
  key: string,
  job: CraftJob,
  onProgress: (progress: LoadProgress) => void,
): CraftModuleHandle {
  job.listeners.add(onProgress);
  let released = false;
  return {
    promise: job.promise.finally(() => {
      job.listeners.delete(onProgress);
    }),
    release() {
      if (released) return;
      released = true;
      job.listeners.delete(onProgress);
      job.users -= 1;
      if (job.users > 0) return;
      if (job.ready) {
        scheduleIdleDrop(key, job);
        return;
      }
      cancelIdleDrop(key);
      job.abort.abort();
      if (jobs.get(key) === job) jobs.delete(key);
    },
  };
}

async function cachedText(url: string): Promise<string> {
  const key = craftCacheKey(url);
  const cache = await openCache();
  const hit = cache === null ? undefined : await cache.match(key);
  if (hit) return hit.text();
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`The app download failed with status ${response.status}.`);
  }
  if (cache !== null) await cache.put(key, response.clone());
  return response.text();
}

export function loadCraftGlue(glueUrl: string): Promise<string> {
  const key = craftCacheKey(glueUrl);
  const existing = glueUrls.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const source = await cachedText(glueUrl);
    const specs = new Set<string>();
    for (const match of source.matchAll(relativeImports())) {
      const spec = match[3];
      if (spec !== undefined) specs.add(spec);
    }
    const blobs = new Map<string, string>();
    for (const spec of specs) {
      const text = await cachedText(new URL(spec, glueUrl).href);
      blobs.set(spec, URL.createObjectURL(new Blob([text], { type: "text/javascript" })));
    }
    const rewritten = rewriteGlueImports(source, (spec) => blobs.get(spec) ?? spec);
    return URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
  })().catch((error: unknown) => {
    glueUrls.delete(key);
    throw error;
  });
  glueUrls.set(key, promise);
  return promise;
}

export function loadCraftModule(
  wasmUrl: string,
  onProgress: (progress: LoadProgress) => void,
): CraftModuleHandle {
  const key = craftCacheKey(wasmUrl);
  const existing = jobs.get(key);
  if (existing) {
    cancelIdleDrop(key);
    existing.users += 1;
    if (existing.last) onProgress(existing.last);
    return attach(key, existing, onProgress);
  }

  const listeners = new Set<(progress: LoadProgress) => void>();
  const abort = new AbortController();
  let job: CraftJob | null = null;
  const report = (progress: LoadProgress) => {
    if (job === null) return;
    job.last = progress;
    for (const listener of job.listeners) listener(progress);
  };
  const promise = (async () => {
    const cache = await openCache();
    const hit = cache === null ? undefined : await cache.match(key);
    if (abort.signal.aborted) throw abort.signal.reason ?? new DOMException("The download was cancelled.", "AbortError");
    if (gzipEncoded(wasmUrl)) await cache?.delete(craftCacheKey(wasmUrl.slice(0, -3)));
    if (hit) {
      report({ phase: "start", loaded: 1, total: 1 });
      try {
        const hitBody = hit.body;
        if (hitBody === null) throw new Error("The saved app download was empty.");
        return await WebAssembly.compileStreaming(asWasm(hitBody, gzipEncoded(wasmUrl)));
      } catch (error) {
        if (abort.signal.aborted) throw error;
        await cache?.delete(key).catch(() => undefined);
      }
    }
    return compileFromNetwork(wasmUrl, key, report, abort.signal);
  })()
    .then((module) => {
      if (job !== null) job.ready = true;
      return module;
    })
    .catch((error: unknown) => {
      if (job !== null && jobs.get(key) === job) jobs.delete(key);
      throw error;
    });
  job = { users: 1, last: null, listeners, abort, ready: false, promise };
  jobs.set(key, job);
  return attach(key, job, onProgress);
}
