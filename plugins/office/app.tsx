import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginFileOpenerProps,
  type PluginFileOpenerSource,
} from "@get-bb/plugin-sdk/app";
import {
  combineLoadProgress,
  createProgressGate,
  loadCraftGlue,
  loadCraftModule,
  loadLabel,
  loadPercent,
  type LoadProgress,
} from "./craft-cache.js";
import { CRAFT_APPS, fileName, saveDestination, type CraftApp } from "./craft-apps.js";
import { craftHostDocument } from "./host-page.js";
import { encodeBase64, loadOfficeBytes, resolveOfficeUrl } from "./office-source.js";
import type { rpcContract } from "./server.js";

type OpenState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

function sourcePayload(source: PluginFileOpenerSource) {
  return {
    kind: source.kind,
    threadId: source.threadId,
    environmentId: source.environmentId,
    projectId: source.projectId,
    ...(source.experimental_hostId
      ? { experimental_hostId: source.experimental_hostId }
      : {}),
  };
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function LoadBar({
  title,
  progressRef,
  onProgressRef,
}: {
  title: string;
  progressRef: { current: LoadProgress | null };
  onProgressRef: { current: (progress: LoadProgress | null) => void };
}) {
  const [progress, setProgress] = useState<LoadProgress | null>(progressRef.current);
  useEffect(() => {
    const gate = createProgressGate(setProgress, (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    });
    onProgressRef.current = (next) => gate.push(next);
    const existing = progressRef.current;
    if (existing !== null) gate.push(existing);
    return () => {
      onProgressRef.current = () => {};
      gate.cancel();
    };
  }, [onProgressRef, progressRef]);
  const percent = loadPercent(progress);
  const label = loadLabel(title, progress);
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-background"
      role="status"
      aria-label={label}
    >
      <div className="w-72 space-y-3">
        <p className="text-center text-sm text-muted-foreground">{label}</p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={`h-full bg-foreground ${percent === null ? "w-1/3 animate-pulse" : ""}`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function CraftFile({
  path,
  source,
  Original,
  app,
}: PluginFileOpenerProps & { app: CraftApp }) {
  const rpc = useRpc<typeof rpcContract>();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentPath = useRef(path);
  const moduleRef = useRef<WebAssembly.Module | null>(null);
  const sessionRef = useRef(0);
  const expectedHtml = useRef<string | null>(null);
  const postModuleRef = useRef<() => void>(() => {});
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [reloadNonce, setReloadNonce] = useState(0);
  const progressRef = useRef<LoadProgress | null>(null);
  const onProgressRef = useRef<(progress: LoadProgress | null) => void>(() => {});
  const [state, setState] = useState<OpenState>({ status: "loading" });
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const url = resolveOfficeUrl(path, source);

  useEffect(() => {
    currentPath.current = path;
  }, [path]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    const sessionId = ++sessionRef.current;
    expectedHtml.current = null;
    progressRef.current = null;
    setState({ status: "loading" });
    setDocumentHtml(null);
    setSaveError(null);
    setDirty(false);
    moduleRef.current = null;

    let fileBytes: ArrayBuffer | null = null;
    let appReady = false;
    let sentFile = false;
    let releaseModule = () => {};

    const deliverFile = () => {
      if (!appReady || fileBytes === null || sentFile || sessionRef.current !== sessionId) return;
      const frame = frameRef.current?.contentWindow;
      if (frame === null || frame === undefined) return;
      const bytes = fileBytes;
      frame.postMessage(
        { type: `${app.id}:open`, name: fileName(currentPath.current), bytes },
        window.location.origin,
        [bytes],
      );
      sentFile = true;
      fileBytes = null;
    };

    const postModule = () => {
      if (sessionRef.current !== sessionId) return;
      const compiled = moduleRef.current;
      const frame = frameRef.current;
      if (compiled === null || frame?.contentWindow == null) return;
      if (expectedHtml.current === null || frame.srcdoc === "") return;
      frame.contentWindow.postMessage(
        { type: `${app.id}:module`, module: compiled },
        window.location.origin,
      );
    };
    postModuleRef.current = postModule;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        name?: string;
        saveAs?: boolean;
        bytes?: unknown;
        dirty?: boolean;
        error?: string;
      } | null;
      if (data === null || typeof data.type !== "string") return;
      if (data.type === `${app.id}:ready`) {
        appReady = true;
        setState({ status: "ready" });
        deliverFile();
        return;
      }
      if (data.type === `${app.id}:failed`) {
        fileBytes = null;
        releaseModule();
        releaseModule = () => {};
        setState({ status: "error", message: data.error ?? "The app could not start" });
        return;
      }
      if (data.type === `${app.id}:dirty`) {
        setDirty(data.dirty === true);
        return;
      }
      if (data.type !== `${app.id}:save`) return;
      const bytes = asBytes(data.bytes);
      if (bytes === null) return;
      const destination = saveDestination(
        currentPath.current,
        data.name ?? fileName(currentPath.current),
        data.saveAs === true,
      );
      void rpcRef.current
        .call("write", {
          path: destination.path,
          source: sourcePayload(source),
          bytesBase64: encodeBase64(bytes),
        })
        .then(() => {
          setSaveError(null);
          if (destination.becomesCurrent) currentPath.current = destination.path;
        })
        .catch((error: unknown) => {
          setSaveError(error instanceof Error ? error.message : String(error));
        });
    };

    window.addEventListener("message", onMessage);
    void (async () => {
      try {
        let wasmProgress: LoadProgress | null = null;
        let fileProgress: LoadProgress | null = null;
        let fileDone = false;
        const publish = () => {
          if (controller.signal.aborted) return;
          const file = fileProgress === null
            ? null
            : fileDone
              ? { phase: "start" as const, loaded: fileProgress.loaded, total: fileProgress.total }
              : fileProgress;
          const next = combineLoadProgress(wasmProgress, file);
          progressRef.current = next;
          onProgressRef.current(next);
        };
        const fileDownload = loadOfficeBytes(url, controller.signal, (progress) => {
          fileProgress = { phase: "download", loaded: progress.loaded, total: progress.total };
          publish();
        }).then((bytes) => {
          fileDone = true;
          fileProgress ??= {
            phase: "download",
            loaded: bytes.byteLength,
            total: bytes.byteLength,
          };
          publish();
          return bytes;
        });
        const lease = await rpcRef.current.call("assets", { id: app.id });
        if (controller.signal.aborted) return;
        const root = lease.baseUrl.endsWith("/") ? lease.baseUrl : `${lease.baseUrl}/`;
        const origin = new URL(root, window.location.origin);
        const glue = new URL(lease.glue, origin).href;
        const wasm = new URL(lease.wasm, origin).href;
        const glueReady = loadCraftGlue(glue);
        const handle = loadCraftModule(wasm, (progress) => {
          wasmProgress = progress;
          publish();
        });
        releaseModule = handle.release;
        const glueForFrame = await glueReady.catch(() => glue);
        if (controller.signal.aborted) return;
        const wasmName = lease.wasm.split("/").pop() ?? app.id;
        const html = craftHostDocument(
          app,
          glueForFrame,
          lease.worker,
          new URL("./", glue).href,
          wasmName,
        );
        expectedHtml.current = html;
        setDocumentHtml(html);
        const [compiled, bytes] = await Promise.all([handle.promise, fileDownload]);
        if (controller.signal.aborted) return;
        fileBytes = bytes;
        moduleRef.current = compiled;
        postModule();
        deliverFile();
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      controller.abort();
      releaseModule();
      if (postModuleRef.current === postModule) postModuleRef.current = () => {};
      window.removeEventListener("message", onMessage);
    };
  }, [
    app,
    path,
    reloadNonce,
    source.environmentId,
    source.experimental_hostId,
    source.kind,
    source.projectId,
    source.threadId,
    url,
  ]);

  if (url === null) return <Original />;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {state.status === "error" ? (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <div className="max-w-md space-y-3 text-center" role="alert">
            <p className="text-sm text-destructive">
              Failed to open {app.title}: {state.message}
            </p>
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-state-hover"
              onClick={() => setReloadNonce((current) => current + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          {state.status === "loading" ? (
            <LoadBar
              title={app.title}
              progressRef={progressRef}
              onProgressRef={onProgressRef}
            />
          ) : null}
          {saveError !== null ? (
            <p className="shrink-0 px-3 py-2 text-sm text-destructive" role="alert">
              Could not save: {saveError}
            </p>
          ) : null}
          <iframe
            ref={frameRef}
            title={path}
            className="block h-full min-h-0 w-full flex-1 border-0"
            allow="fullscreen; clipboard-read; clipboard-write"
            srcDoc={documentHtml ?? undefined}
            onLoad={() => {
              postModuleRef.current();
            }}
          />
        </>
      )}
    </div>
  );
}

export default definePluginApp((plugin) => {
  for (const app of CRAFT_APPS) {
    plugin.slots.fileOpener({
      id: app.id,
      title: app.title,
      extensions: [...app.extensions],
      component: (props) => <CraftFile {...props} app={app} />,
    });
  }
});
