import type { CraftApp } from "./craft-apps.js";

function craftAssetShim(epoch: string): string {
  return `
    function installCraftCache() {
      const craftEpoch = ${JSON.stringify(epoch)};
      const craftCacheName = "boltrig-craft-web";
      const nativeFetch = globalThis.fetch.bind(globalThis);
      const assetName = (url) => {
        try {
          const parsed = new URL(url, globalThis.location.href);
          if (parsed.origin !== globalThis.location.origin) return null;
          const name = parsed.pathname.split("/").pop() || "";
          if (!/^[A-Za-z0-9._-]+\\.(onnx|wasm)$/.test(name)) return null;
          if (name.includes("-web-") || name.endsWith(".gz")) return null;
          return name;
        } catch {
          return null;
        }
      };
      const cachedFetch = async (input, init) => {
        const method = init && init.method ? init.method : "GET";
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const name = method === "GET" ? assetName(url) : null;
        if (name === null) return nativeFetch(input, init);
        try {
          const cache = await caches.open(craftCacheName);
          const key = "https://boltrig-craft.local/" + craftEpoch + "/" + name;
          const hit = await cache.match(key);
          if (hit) return hit.clone();
          const parsed = new URL(url, globalThis.location.href);
          const gz = name.endsWith(".wasm")
            ? await nativeFetch(new URL(parsed.pathname + ".gz", parsed.origin), init)
            : null;
          if (gz && gz.ok && gz.body) {
            const plain = gz.body.pipeThrough(new DecompressionStream("gzip"));
            const parts = plain.tee();
            const headers = { "content-type": "application/octet-stream" };
            void cache.put(key, new Response(parts[1], { headers }));
            return new Response(parts[0], { headers });
          }
          const response = await nativeFetch(input, init);
          if (response.ok) await cache.put(key, response.clone());
          return response;
        } catch {
          return nativeFetch(input, init);
        }
      };
      globalThis.fetch = cachedFetch;
    }
    installCraftCache();
    const NativeCraftWorker = globalThis.Worker;
    globalThis.Worker = function CraftWorker(scriptUrl, options) {
      const address = typeof scriptUrl === "string" ? scriptUrl : String(scriptUrl);
      if (!address.includes("_loader.js")) return new NativeCraftWorker(scriptUrl, options);
      const source = "(" + installCraftCache.toString() + ")();\\nawait import(" + JSON.stringify(address) + ");";
      const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      return new NativeCraftWorker(blobUrl, Object.assign({}, options, { type: "module" }));
    };
  `;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function craftHostDocument(
  app: Pick<CraftApp, "id" | "canvasId" | "loadingId">,
  glueUrl: string,
  worker: string | null = null,
  assetRoot: string | null = null,
  cacheEpoch: string | null = null,
): string {
  const script = `
    ${craftAssetShim(cacheEpoch ?? "craft")}
    const app = ${JSON.stringify(app.id)};
    const canvas = document.getElementById(${JSON.stringify(app.canvasId)});
    const loading = document.getElementById(${JSON.stringify(app.loadingId)});
    const send = (type, detail, transfer) => {
      parent.postMessage({ type, ...detail }, location.origin, transfer ?? []);
    };
    canvas.addEventListener(app + ":ready", () => {
      loading?.remove();
      send(app + ":ready", {});
    });
    canvas.addEventListener(app + ":save", (event) => {
      const bytes = event.detail.bytes;
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const buffer = view.slice().buffer;
      parent.postMessage({
        type: app + ":save",
        name: String(event.detail.name ?? ""),
        saveAs: event.detail.saveAs === true,
        bytes: buffer,
      }, location.origin, [buffer]);
    });
    canvas.addEventListener(app + ":dirty", (event) => {
      send(app + ":dirty", { dirty: event.detail.dirty === true });
    });
    canvas.addEventListener(app + ":failed", (event) => {
      send(app + ":failed", { error: String(event.detail.error ?? "The app could not start") });
    });
    const glueReady = import(${JSON.stringify(glueUrl)});
    let booted = false;
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type === app + ":module" && !booted) {
        booted = true;
        void glueReady
          .then((mod) => mod.default({ module_or_path: event.data.module }))
          .catch((error) => {
            send(app + ":failed", { error: error instanceof Error ? error.message : String(error) });
          });
        return;
      }
      if (event.data?.type !== app + ":open") return;
      canvas.dispatchEvent(new CustomEvent(app + ":open", {
        detail: { name: event.data.name, bytes: event.data.bytes },
      }));
    });
  `;
  const root = assetRoot ?? new URL("./", glueUrl).href;
  const workerMeta =
    worker === null
      ? ""
      : `<meta name="pdfcraft-ocr-worker" content="${escapeAttr(worker)}">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <base href="${escapeAttr(root)}">
  ${workerMeta}
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #e6e6e6; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    #${app.loadingId} { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #555; font: 14px system-ui, sans-serif; }
  </style>
</head>
<body>
  <canvas id="${app.canvasId}" data-host="page"></canvas>
  <div id="${app.loadingId}">Loading ${app.id}…</div>
  <script type="module">${script}</script>
</body>
</html>`;
}
