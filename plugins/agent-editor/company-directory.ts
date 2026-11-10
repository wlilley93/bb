import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function runClosed(bin: string, args: readonly string[], input = ""): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(stderr.trim() || stdout.trim() || `exit ${code}`), { stderr }));
    });
    child.stdin.end(input);
  });
}

/** One company root, shared by both editors. Not a per-plugin setting. */
export const SHARED_ROOT_FILE = path.join(homedir(), ".config", "boltrig", "company-root.json");

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LOCKED_KEYS = ["mode", "tier", "rank", "permissions", "class", "color", "reach"] as const;

export class CompanyDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyDirectoryError";
  }
}

export interface CompanyLayout {
  rootFile: string;
  packDir: string;
  opencodeDir: string;
  configPackage: string;
}

export interface InstalledSeat {
  id: string;
  mode: string;
  tier: string;
  rank: string;
  permissions: string;
  reach: string;
}

export interface RenderThenRestartResult {
  ready: boolean;
  restarted: boolean;
  reason: string;
}

export function companyDir(root: string): string {
  return path.join(root, "Agent Operations");
}

export async function readSharedRoot(rootFile = SHARED_ROOT_FILE): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(rootFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("root" in parsed)) return null;
    const root = parsed.root;
    return typeof root === "string" && root.length > 0 ? root : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function writeSharedRoot(root: string, rootFile = SHARED_ROOT_FILE): Promise<string> {
  const canonical = await assertCompanyRoot(root);
  await mkdir(path.dirname(rootFile), { recursive: true });
  await writeFile(rootFile, `${JSON.stringify({ root: canonical }, null, 2)}\n`, "utf8");
  return canonical;
}

/** The root must already be a directory. Agent Operations is created under it. */
export async function assertCompanyRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new CompanyDirectoryError("The company root must be an absolute path.");
  if (root === path.parse(root).root) throw new CompanyDirectoryError("The company root cannot be the filesystem root.");
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    if (isMissing(error)) throw new CompanyDirectoryError("The company root does not exist.");
    throw error;
  }
  if (!info.isDirectory()) throw new CompanyDirectoryError("The company root must be a directory.");
  return realpath(root);
}

export async function ensureCompanyDirectory(root: string, packDir: string): Promise<string> {
  const canonical = await assertCompanyRoot(root);
  const installer = path.join(packDir, "install.mjs");
  const { stdout } = await run(process.execPath, [installer, canonical], { encoding: "utf8" });
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !("directory" in parsed) || typeof parsed.directory !== "string") {
    throw new CompanyDirectoryError("The company pack installer did not name a directory.");
  }
  return parsed.directory;
}

export async function listInstalledSeats(opencodeDir: string): Promise<{ doctrine: string; seats: InstalledSeat[] }> {
  const agentsDir = path.join(opencodeDir, "agents");
  const names = await readdir(agentsDir).catch((error: unknown) => {
    if (isMissing(error)) return [] as string[];
    throw error;
  });
  const seats: InstalledSeat[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const text = await readFile(path.join(agentsDir, name), "utf8");
    const matter = frontMatter(text);
    const id = name.slice(0, -3);
    seats.push({
      id,
      mode: scalar(matter, "mode"),
      tier: installedTier(id, scalar(matter, "tier")),
      rank: scalar(matter, "rank"),
      permissions: block(matter, "permissions"),
      reach: section(text, "Reach"),
    });
  }
  let doctrine = "";
  try {
    doctrine = await readFile(path.join(opencodeDir, "boltrig-doctrine.md"), "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return { doctrine, seats };
}

export async function saveCanonDuty(dir: string, seat: string, body: string, opencodeDir: string): Promise<string> {
  assertId(seat, "seat");
  const installed = await listInstalledSeats(opencodeDir);
  if (!installed.seats.some((entry) => entry.id === seat)) {
    throw new CompanyDirectoryError(`No installed canon seat is named ${seat}.`);
  }
  refuseLockedBody(body);
  const file = path.join(dir, "Duties", `${seat}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, matter({ seat }, body), "utf8");
  return file;
}

export async function readCanonDuty(dir: string, seat: string): Promise<string> {
  assertId(seat, "seat");
  const file = path.join(dir, "Duties", `${seat}.md`);
  if (!(await exists(file))) return "";
  const text = await readFile(file, "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
}

export async function saveSeatRequest(dir: string, base: "head" | "vp" | "pm", id: string, body: string, opencodeDir: string): Promise<string> {
  assertId(id, "id");
  if (!["head", "vp", "pm"].includes(base)) throw new CompanyDirectoryError("base must be head, vp or pm.");
  refuseLockedBody(body);
  const agentsFile = path.join(opencodeDir, "agents", `${id}.md`);
  if (await exists(agentsFile)) throw new CompanyDirectoryError("This screen does not create a peer profile.");
  const file = path.join(dir, "Roles", `${id}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, matter({ base, id }, body), "utf8");
  return file;
}

export async function saveRole(dir: string, packDir: string, id: string, base: "subagent" | "primary", body: string, opencodeDir: string): Promise<string> {
  assertId(id, "id");
  if (base !== "subagent" && base !== "primary") throw new CompanyDirectoryError("A role base is subagent or primary.");
  refuseLockedBody(body);
  const agentsFile = path.join(opencodeDir, "agents", `${id}.md`);
  if (await exists(agentsFile)) throw new CompanyDirectoryError("A role is not written into the OpenCode config agents directory.");
  await readFile(path.join(packDir, "templates", "roles", "role.md"), "utf8");
  const file = path.join(dir, "Roles", `${id}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, matter({ base, id }, body), "utf8");
  return file;
}

/** Seed the company directory into the OpenCode config. Restart only when a command is named. */
export async function renderThenRestart(args: {
  root: string;
  opencodeDir: string;
  packDir: string;
  configPackage: string;
  restartCommand?: readonly string[];
}): Promise<RenderThenRestartResult> {
  await ensureCompanyDirectory(args.root, args.packDir);
  const seed = path.join(args.configPackage, "seed.mjs");
  try {
    const overlayFile = path.join(args.opencodeDir, "roster-overlay.json");
    const hasOverlay = await exists(overlayFile);
    const { stdout } = await runClosed(process.execPath, [
      seed,
      "seed",
      args.opencodeDir,
      "--company-root",
      args.root,
    ], hasOverlay ? "" : "{\"schema_version\":1,\"allow_unpinned\":true}\n");
    const rendered: unknown = JSON.parse(stdout);
    const requests = companyRequests(rendered);
    const command = args.restartCommand ?? [];
    if (command.length === 0) {
      return {
        ready: true,
        restarted: false,
        reason: requests.length > 0
          ? `Rendered. OpenCode was not restarted. These are requests and were not installed: ${requests.join(", ")}.`
          : "Rendered into the OpenCode config. OpenCode was not restarted because no service was named.",
      };
    }
    const [bin, ...rest] = command;
    if (!bin) throw new CompanyDirectoryError("The restart command is empty.");
    await run(bin, rest, { encoding: "utf8" });
    return { ready: true, restarted: true, reason: "Rendered into the OpenCode config and restarted OpenCode." };
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    const message = error instanceof Error ? error.message : String(error);
    return { ready: false, restarted: false, reason: stderr.trim() || message };
  }
}

function companyRequests(rendered: unknown): string[] {
  if (typeof rendered !== "object" || rendered === null || !("company" in rendered)) return [];
  const company = rendered.company;
  if (typeof company !== "object" || company === null || !("requests" in company) || !Array.isArray(company.requests)) return [];
  return company.requests.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || !("id" in entry) || !("base" in entry)) return [];
    return [`${String(entry.base)} ${String(entry.id)}`];
  });
}

export interface SopFile {
  path: string;
  title: string;
}

export async function listSopFiles(dir: string): Promise<SopFile[]> {
  const fixed = [
    "Instructions/firm.md",
    "Instructions/people.md",
    "LINEAR.md",
    "policies/POLICY-REGISTER.md",
  ];
  const files: SopFile[] = fixed.map((relative) => ({ path: relative, title: relative }));
  files.push(...(await markdownUnder(dir, "References")));
  files.push(...(await markdownUnder(dir, "Roles")));
  files.push(...(await markdownUnder(dir, "Playbooks")));
  files.push(...(await markdownUnder(dir, "Duties")));
  return files;
}

export async function readCompanyFile(dir: string, relative: string): Promise<string> {
  return readFile(checkedPath(dir, relative), "utf8");
}

export async function saveCompanyFile(dir: string, relative: string, body: string, today: string): Promise<void> {
  const file = checkedPath(dir, relative);
  if (relative.startsWith("Roles/") && /^permissions\s*:/m.test(frontMatter(body))) {
    throw new CompanyDirectoryError("A permission change is a row in the policy register, not a permission header.");
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, stampProvenance(body, today), "utf8");
  if (relative.startsWith("References/") && relative.endsWith(".md")) {
    const name = path.basename(relative, ".md");
    await upsertIndexLine(dir, name, `load when this reference is named`, today);
  }
}

export async function addPermissionRequest(
  dir: string,
  row: { id: string; rule: string; reason: string; layer: string; gap: string; owner: string },
  today: string,
): Promise<void> {
  assertId(row.id, "id");
  const relative = "policies/POLICY-REGISTER.md";
  const file = checkedPath(dir, relative);
  const text = await readFile(file, "utf8");
  const line = `| ${row.id} | ${cell(row.rule)} | ${cell(row.reason)} | ${cell(row.layer)} | ${cell(row.gap)} | ${cell(row.owner)} |`;
  if (text.includes(`| ${row.id} |`)) throw new CompanyDirectoryError(`The policy register already has ${row.id}.`);
  const marker = "\n## Closing a gap";
  const next = text.includes(marker) ? text.replace(marker, `\n${line}${marker}`) : `${text.trimEnd()}\n${line}\n`;
  await writeFile(file, stampProvenance(next, today), "utf8");
}

async function upsertIndexLine(dir: string, name: string, when: string, today: string): Promise<void> {
  const relative = "Instructions/firm.md";
  const file = checkedPath(dir, relative);
  const text = await readFile(file, "utf8");
  const line = `- \`${name}\` — ${when}.`;
  const pattern = new RegExp(`^- \\\`${name}\\\` —.*$`, "m");
  let next: string;
  if (pattern.test(text)) next = text.replace(pattern, line);
  else if (text.includes("References:\n")) next = text.replace("References:\n", `References:\n${line}\n`);
  else next = `${text.trimEnd()}\n\n## Index\n\nReferences:\n${line}\n`;
  await writeFile(file, stampProvenance(next, today), "utf8");
}

function stampProvenance(text: string, today: string): string {
  const line = `<!-- from: Company SOP Editor ${today} -->`;
  if (text.startsWith("<!-- from:")) return text.replace(/^<!-- from:.*?-->/, line);
  return `${line}\n${text}`;
}

function matter(fields: Record<string, string>, body: string): string {
  const yaml = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n");
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

function refuseLockedBody(body: string): void {
  const matterText = frontMatter(body);
  for (const key of LOCKED_KEYS) {
    if (new RegExp(`^${key}\\s*:`, "m").test(matterText)) {
      throw new CompanyDirectoryError(`The editor cannot write ${key}.`);
    }
  }
}

function assertId(value: string, label: string): void {
  if (!ID.test(value)) throw new CompanyDirectoryError(`${label} must be a lowercase id.`);
}

function cell(value: string): string {
  return value.replaceAll("|", "/").replaceAll("\n", " ").trim();
}

function frontMatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  return match?.[1] ?? "";
}

function scalar(matterText: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(matterText);
  return match?.[1]?.trim() ?? "";
}

/** A declared tier wins. An older profile with none takes it from the id prefix. */
function installedTier(id: string, declared: string): string {
  if (declared.length > 0) return declared;
  const prefix = id.split("-", 1)[0];
  if (prefix === "head" || prefix === "vp" || prefix === "pm") return prefix;
  return "";
}

function block(matterText: string, key: string): string {
  const lines = matterText.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return "";
  const collected = [lines[start] ?? ""];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
    collected.push(line);
  }
  return collected.join("\n").trim();
}

function section(text: string, heading: string): string {
  const match = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$)`, "m").exec(text);
  return match?.[1]?.trim() ?? "";
}

function checkedPath(dir: string, relative: string): string {
  if (relative.includes("\0") || path.isAbsolute(relative)) throw new CompanyDirectoryError("That file is outside the company directory.");
  const file = path.resolve(dir, relative);
  const root = path.resolve(dir);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    throw new CompanyDirectoryError("That file is outside the company directory.");
  }
  const allowed = relative === "LINEAR.md"
    || relative.startsWith("Instructions/")
    || relative.startsWith("References/")
    || relative.startsWith("policies/")
    || relative.startsWith("Playbooks/")
    || relative.startsWith("Skills/")
    || relative.startsWith("Roles/")
    || relative.startsWith("Duties/")
    || relative.startsWith("Requests/");
  if (!allowed) throw new CompanyDirectoryError("That file is not part of the company SOP.");
  return file;
}

async function markdownUnder(dir: string, folder: string): Promise<SopFile[]> {
  const absolute = path.join(dir, folder);
  let names: string[];
  try {
    names = await readdir(absolute);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".md")).sort().map((name) => ({
    path: `${folder}/${name}`,
    title: `${folder}/${name}`,
  }));
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

const RECORD_NAMES = ["function.json", "client.json", "project.json", "queue.json"];
const SCAN_SKIP = new Set(["node_modules", ".git", "Library", "Backups", "dist", "build", ".next", "target", "coverage", ".cache", ".venv", "Pods"]);
const SCAN_DEPTH = 3;

interface HomeMatch { path: string; depth: number; tier: string }

const RECORD_TIERS = new Set(["head", "vp", "pm", "seat", "none"]);

/**
 * The folder owns the agent, as OpenChamber's home scan does. A `.meta` record
 * names `agent_profile`. One folder for that profile opens that folder. Several
 * folders open the head's folder, which is the one place that profile's domain lives.
 */
export async function listSeatFolders(root: string): Promise<Array<{ path: string; name: string; seat: string; tier: string }>> {
  const homes = await recordedHomes(root);
  const folders: Array<{ path: string; name: string; seat: string; tier: string }> = [];
  for (const [seat, matches] of homes) {
    if (!ID.test(seat)) continue;
    for (const match of matches) {
      folders.push({ path: match.path, name: path.basename(match.path), seat, tier: match.tier });
    }
  }
  folders.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  return folders;
}

export async function folderForSeat(root: string, seatId: string): Promise<{ path: string; name: string; own: boolean } | null> {
  if (!ID.test(seatId)) return null;
  const homes = await recordedHomes(root);
  const own = soleFolder(homes.get(seatId));
  const stem = seatId.replace(/^(?:vp|pm)-/, "");
  const head = stem === seatId ? null : soleFolder(homes.get(`head-${stem}`));
  const folder = own ?? head;
  if (!folder) return null;
  return { path: folder, name: path.basename(folder), own: own === folder };
}

function soleFolder(matches: readonly HomeMatch[] | undefined): string | null {
  if (!matches || matches.length === 0) return null;
  const depth = Math.min(...matches.map((match) => match.depth));
  const shallow = matches.filter((match) => match.depth === depth);
  return shallow.length === 1 ? shallow[0].path : null;
}

let homeCache: { root: string; expires: number; homes: Map<string, HomeMatch[]> } | null = null;

async function recordedHomes(root: string): Promise<Map<string, HomeMatch[]>> {
  const canonical = await realpath(root);
  if (homeCache && homeCache.root === canonical && homeCache.expires > Date.now()) return homeCache.homes;
  const homes = new Map<string, HomeMatch[]>();
  await walkHomes(canonical, canonical, 0, homes);
  homeCache = { root: canonical, expires: Date.now() + 30_000, homes };
  return homes;
}

async function walkHomes(root: string, directory: string, depth: number, homes: Map<string, HomeMatch[]>): Promise<void> {
  const record = await readProfile(directory);
  if (record && ID.test(record.profile)) {
    const list = homes.get(record.profile);
    const match = { path: directory, depth, tier: record.tier };
    if (list) list.push(match);
    else homes.set(record.profile, [match]);
  }
  if (depth >= SCAN_DEPTH) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SCAN_SKIP.has(entry.name)) continue;
    const next = path.join(directory, entry.name);
    try {
      if ((await lstat(next)).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    if (!isWithin(root, next)) continue;
    await walkHomes(root, next, depth + 1, homes);
  }
}

function recordTier(profile: string, declared: unknown): string {
  if (typeof declared === "string" && RECORD_TIERS.has(declared.trim())) return declared.trim();
  if (profile === "none") return "none";
  const prefix = profile.split("-", 1)[0];
  if (prefix === "head" || prefix === "vp" || prefix === "pm") return prefix;
  return "seat";
}

async function readProfile(directory: string): Promise<{ profile: string; tier: string } | null> {
  const metadata = path.join(directory, ".meta");
  let entries;
  try {
    if (!(await lstat(metadata)).isDirectory()) return null;
    entries = await readdir(metadata, { withFileTypes: true });
  } catch {
    return null;
  }
  const records = entries.filter((entry) => RECORD_NAMES.includes(entry.name) && entry.isFile());
  if (records.length !== 1) return null;
  const record = records[0];
  if (!record) return null;
  const file = path.join(metadata, record.name);
  try {
    if ((await lstat(file)).size > 65_536) return null;
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isRecord(parsed) || typeof parsed.agent_profile !== "string") return null;
    const id = parsed.agent_profile.trim();
    return { profile: id, tier: recordTier(id, parsed.tier) };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
