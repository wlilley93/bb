import { describe, expect, it } from "vitest";
import { encodeBase64, readBodyWithProgress, resolveOfficeUrl } from "./office-source.js";

const ids = {
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: "proj_1",
};

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("readBodyWithProgress", () => {
  it("fills one buffer when the size is known", async () => {
    const seen: number[] = [];
    const bytes = await readBodyWithProgress(
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]),
      3,
      (progress) => seen.push(progress.loaded),
    );
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(seen.at(-1)).toBe(3);
  });

  it("stops when the server sends more than it promised", async () => {
    await expect(
      readBodyWithProgress(streamOf([new Uint8Array([1, 2, 3])]), 2),
    ).rejects.toThrow("The file was larger than the server reported.");
  });
});

describe("encodeBase64", () => {
  it("matches a single encoding across a chunk boundary", () => {
    const bytes = new Uint8Array(9000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(encodeBase64(new Uint8Array())).toBe("");
  });
});

describe("resolveOfficeUrl", () => {
  it("routes a workspace file through its environment", () => {
    expect(
      resolveOfficeUrl("docs/a report.docx", { kind: "workspace", ...ids }),
    ).toBe("/api/v1/environments/env_1/files/docs/a%20report.docx");
  });

  it("routes a host file through the thread", () => {
    expect(
      resolveOfficeUrl("/tmp/a report.xlsx", { kind: "host", ...ids }),
    ).toBe("/api/v1/threads/thr_1/host-files/tmp/a%20report.xlsx");
  });
});
