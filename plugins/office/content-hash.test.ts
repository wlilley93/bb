import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256File } from "./content-hash.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("sha256File", () => {
  it("hashes a file without changing the digest", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "office-hash-"));
    directories.push(directory);
    const filePath = path.join(directory, "app.zip");
    const bytes = Buffer.from("office-web-build");
    await writeFile(filePath, bytes);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await sha256File(filePath)).toBe(expected);
    expect((await readFile(filePath)).equals(bytes)).toBe(true);
  });
});
