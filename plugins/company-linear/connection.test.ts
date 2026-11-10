import { lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConnection, writeConnection } from "./connection.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("linear connection file", () => {
  it("stores the refresh token on this server at mode 0600 and refuses a link", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boltrig-linear-"));
    dirs.push(dir);
    const file = path.join(dir, "linear-connection.json");
    await writeConnection({ accessToken: "access", refreshToken: "refresh", expiresAt: 10 }, file);
    const info = await lstat(file);
    expect(info.mode & 0o777).toBe(0o600);
    expect((await readConnection(file))?.refreshToken).toBe("refresh");
    await writeConnection(null, file);
    await expect(readConnection(file)).resolves.toBeNull();
    const link = path.join(dir, "linked.json");
    await symlink(file, link);
    await expect(writeConnection({ accessToken: "a", refreshToken: "b", expiresAt: 1 }, link)).rejects.toThrow("link");
  });
});
