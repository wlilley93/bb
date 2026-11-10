import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function resolveOfficeUrl(
  path: string,
  source: PluginFileOpenerSource,
): string | null {
  const filePath = encodePathSegments(path.replace(/^\/+/u, ""));
  switch (source.kind) {
    case "workspace":
      if (source.environmentId !== null) {
        return `/api/v1/environments/${encodeURIComponent(source.environmentId)}/files/${filePath}`;
      }
      if (source.projectId !== null) {
        const projectPath = `/api/v1/projects/${encodeURIComponent(source.projectId)}`;
        return source.experimental_hostId
          ? `${projectPath}/hosts/${encodeURIComponent(source.experimental_hostId)}/files/${filePath}`
          : `${projectPath}/files/${filePath}`;
      }
      return null;
    case "host":
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/host-files/${filePath}`;
    case "thread-storage":
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/thread-storage/files/${filePath}`;
  }
}

const REPORT_EVERY_BYTES = 512 * 1024;

export interface ByteProgress {
  loaded: number;
  total: number | null;
}

export async function readBodyWithProgress(
  body: ReadableStream<Uint8Array>,
  total: number | null,
  onProgress?: (progress: ByteProgress) => void,
): Promise<ArrayBuffer> {
  const reader = body.getReader();
  let reported = 0;
  const report = (loaded: number, reportTotal: number | null, force = false) => {
    if (onProgress === undefined) return;
    if (!force && reported !== 0 && loaded - reported < REPORT_EVERY_BYTES) return;
    reported = loaded;
    onProgress({ loaded, total: reportTotal });
  };
  try {
    if (total !== null) {
      const bytes = new Uint8Array(total);
      let offset = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const end = offset + value.byteLength;
        if (end > bytes.byteLength) {
          throw new Error("The file was larger than the server reported.");
        }
        bytes.set(value, offset);
        offset = end;
        report(offset, total);
      }
      report(offset, total, true);
      return offset === bytes.byteLength ? bytes.buffer : bytes.slice(0, offset).buffer;
    }
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      report(loaded, null);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    report(loaded, loaded > 0 ? loaded : null, true);
    return bytes.buffer;
  } finally {
    reader.releaseLock();
  }
}

export async function loadOfficeBytes(
  url: string,
  signal: AbortSignal,
  onProgress?: (progress: ByteProgress) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`File request failed with status ${response.status}.`);
  }
  const header = Number(response.headers.get("content-length"));
  const total = Number.isFinite(header) && header > 0 ? header : null;
  const body = response.body;
  if (body === null) {
    const bytes = await response.arrayBuffer();
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength });
    return bytes;
  }
  return readBodyWithProgress(body, total, onProgress);
}

export function encodeBase64(bytes: Uint8Array): string {
  const chunk = 8184;
  let encoded = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    encoded += btoa(String.fromCharCode(...slice));
  }
  return encoded;
}
