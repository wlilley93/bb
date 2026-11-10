import { describe, expect, it } from "vitest";
import {
  combineLoadProgress,
  craftCacheKey,
  createProgressGate,
  loadLabel,
  loadPercent,
  rewriteGlueImports,
} from "./craft-cache.js";

describe("craft loading", () => {
  it("keys the cache by the build file, not the preview lease", () => {
    expect(
      craftCacheKey(
        "https://bb.example/api/v1/file-previews/lease-1/wordcraft/wordcraft-web-abc_bg.wasm",
      ),
    ).toBe("https://boltrig-craft.local/wordcraft-web-abc_bg.wasm");
    expect(
      craftCacheKey(
        "https://bb.example/api/v1/file-previews/lease-2/wordcraft/wordcraft-web-abc_bg.wasm",
      ),
    ).toBe("https://boltrig-craft.local/wordcraft-web-abc_bg.wasm");
  });

  it("describes the download and then the start", () => {
    expect(loadLabel("WordCraft", null)).toBe("Loading WordCraft…");
    expect(
      loadLabel("WordCraft", { phase: "download", loaded: 20 * 1024 * 1024, total: 60 * 1024 * 1024 }),
    ).toBe("Loading WordCraft… 20.0 MB of 60.0 MB");
    expect(loadLabel("WordCraft", { phase: "start", loaded: 1, total: 1 })).toBe(
      "Starting WordCraft…",
    );
    expect(loadPercent({ phase: "download", loaded: 15, total: 60 })).toBe(25);
    expect(loadPercent({ phase: "start", loaded: 1, total: 1 })).toBeNull();
    expect(loadPercent({ phase: "download", loaded: 10, total: null })).toBeNull();
  });

  it("counts the app download and the open file on one bar", () => {
    expect(
      combineLoadProgress(
        { phase: "download", loaded: 10, total: 20 },
        { phase: "download", loaded: 5, total: 10 },
      ),
    ).toEqual({ phase: "download", loaded: 15, total: 30 });
    expect(
      combineLoadProgress(
        { phase: "start", loaded: 1, total: 1 },
        { phase: "download", loaded: 5, total: 10 },
      ),
    ).toEqual({ phase: "download", loaded: 5, total: 10 });
    expect(
      combineLoadProgress(
        { phase: "start", loaded: 20, total: 20 },
        { phase: "start", loaded: 10, total: 10 },
      ),
    ).toEqual({ phase: "start", loaded: 1, total: 1 });
    expect(combineLoadProgress(null, null)).toBeNull();
  });

  it("keeps one progress update from a burst", () => {
    const seen: Array<number | null> = [];
    let run: (() => void) | null = null;
    const gate = createProgressGate(
      (progress) => seen.push(progress?.loaded ?? null),
      (callback) => {
        run = callback;
        return () => {
          run = null;
        };
      },
    );
    gate.push({ phase: "download", loaded: 1, total: 10 });
    gate.push({ phase: "download", loaded: 9, total: 10 });
    expect(seen).toEqual([]);
    run?.();
    expect(seen).toEqual([9]);
    gate.cancel();
    gate.push({ phase: "download", loaded: 10, total: 10 });
    expect(seen).toEqual([9]);
  });

  it("points the glue's own imports at saved copies", () => {
    const source = [
      "import { activate } from './snippets/eframe/inline0.js';",
      'import * as extra from "./snippets/eframe/inline0.js"',
    ].join("\n");
    const rewritten = rewriteGlueImports(source, () => "blob:snippet");
    expect(rewritten).toContain("from 'blob:snippet'");
    expect(rewritten).toContain('from "blob:snippet"');
    expect(rewritten).not.toContain("./snippets/");
  });
});
