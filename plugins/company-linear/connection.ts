import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { LinearTokens } from "./linear.js";
import { LinearError } from "./linear.js";

const DEFAULT_FILE = path.join(homedir(), ".config", "boltrig", "linear-connection.json");

export interface ConnectionFile {
  file?: string;
}

export async function readConnection(file = DEFAULT_FILE): Promise<LinearTokens | null> {
  let info;
  try {
    info = await lstat(file);
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) throw new LinearError("The Linear connection file is a link and was not read.");
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.refreshToken !== "string" || typeof record.accessToken !== "string" || typeof record.expiresAt !== "number") {
    return null;
  }
  return { refreshToken: record.refreshToken, accessToken: record.accessToken, expiresAt: record.expiresAt };
}

export async function writeConnection(tokens: LinearTokens | null, file = DEFAULT_FILE): Promise<void> {
  let info;
  try {
    info = await lstat(file);
  } catch {
    info = null;
  }
  if (info?.isSymbolicLink()) throw new LinearError("The Linear connection file is a link and was not written.");
  if (!tokens) {
    if (info) await rm(file);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
