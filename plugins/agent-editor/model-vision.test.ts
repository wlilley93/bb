import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answerVision, loadVisionMap, resetVisionMemory, visionMapFromCatalog } from "./model-vision.js";

const catalog = {
  opencode: {
    models: {
      a: { name: "GLM-5.3 Flash Free", modalities: { input: ["text", "image"] } },
      b: { name: "GLM-5.3", modalities: { input: ["text"] } },
      c: { name: "No modalities" },
    },
  },
};

const dirs: string[] = [];

afterEach(async () => {
  resetVisionMemory();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("model vision", () => {
  it("reads image support from the catalog and ignores entries without modalities", () => {
    const map = visionMapFromCatalog(catalog);
    expect(map).toEqual({ glm53flashfree: true, glm53: false });
    expect(answerVision(map, "GLM-5.3")).toEqual({ image: false, source: "catalog" });
    expect(answerVision(map, "Something else")).toEqual({ image: null, source: "unknown" });
  });

  it("trusts a rejection seen in the field over the catalog", () => {
    const map = visionMapFromCatalog(catalog);
    expect(answerVision(map, "GLM-5.3-Flash Free")).toEqual({ image: false, source: "known-rejection" });
  });

  it("caches the catalog on disk and survives a failed download", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "model-vision-"));
    dirs.push(dir);
    const file = path.join(dir, "cache", "vision.json");
    let calls = 0;
    const map = await loadVisionMap(file, async () => {
      calls += 1;
      return catalog;
    });
    expect(map.glm53).toBe(false);
    resetVisionMemory();
    await loadVisionMap(file, async () => {
      calls += 1;
      return catalog;
    });
    expect(calls).toBe(1);
    resetVisionMemory();
    const empty = await loadVisionMap(path.join(dir, "other.json"), async () => {
      throw new Error("offline");
    });
    expect(empty).toEqual({});
  });
});
