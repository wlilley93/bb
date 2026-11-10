import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useBbNavigate, useRpc, useSdk, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { agentEditorRpc } from "./server.js";
import { focusRing, seatTone } from "./chrome.js";
import { liveHeadFolders, nestSeatFolders, type NestedSeatFolder, type SeatFolder } from "./seat-folders.js";

interface Seat {
  id: string;
  tier: string;
}

interface Node {
  seat: Seat;
  folder: SeatFolder | null;
  children: Node[];
}

/**
 * Already shipped, so a later pass should leave these alone:
 * - A seat opens in place. The page does not reload.
 * - A second click on the seat already on screen only opens or closes its folders.
 * - The bare `vp` and `pm` rows stay out of the tree.
 * - A head is one row: a small mark and the real folder name. Each row under it is a folder on disk.
 * - Home, Children and Estate stay separate rows when they share one seat. A PM is the last row.
 * - Rows are 28px, like Linear. Each level steps in by 16px. The fold mark sits at the end of the row.
 * - That folder's other threads sit beside the chat.
 * - Only the head on screen is expanded. The folders above the open row stay open with it.
 * - Only the folder on screen is highlighted, with the theme highlight, and the highlight stays on that row. A row lights on hover.
 * - The composer starts as one line, with its controls underneath, and scrolls after 17 lines.
 * - The seat name is drawn over the composer, not inserted into it. The page is not watched for every change. A burst of seat clicks changes the composer once, after the clicks settle. The agent menu is not closed with Escape. The list says it is loading until the seats arrive. A row's name cannot be dragged into a selection. The phone menu does not animate when motion is reduced. A seat name and its fold show a focus ring from the keyboard. The fold mark darkens when the pointer or the keyboard is on it. The threads beside the chat use the same row size as the seats.
 * - New thread, including the phone plus, opens a fresh chat for the seat already on screen.
 * - On a phone the sidebar fills the screen. Five controls share the full width: three chosen icons, a chevron that pops a menu you can drag, and new thread. The footer icon row stays hidden. The menu is two-thirds of the bar, starting a tenth of the way in. Its title is the workspace, with settings on the right, in a slightly smaller font. It lists the other sections, the file browser, and the bug report. A row darkens while it is pressed, and so does a bar icon. Picking a seat closes the menu. The open seat stays in view. The swipe tracks the full width of the screen, and the bar leaves as soon as the drawer closes. The fold control is large enough to hit. The open section is marked. Escape closes the menu. Customise picks the three. Row text is larger.
 */
const managed = new Set(["head", "vp", "pm"]);
const loose = new Set(["vp", "pm"]);
const rememberedKey = "boltrig.seatThreads";
const pendingKey = "boltrig.seatPending";
const leftKey = "boltrig.seatLeft";
const activeKey = "boltrig.activeSeat";
const folderKey = "boltrig.activeFolder";
const tierKey = "boltrig.activeTier";
const closedKey = "boltrig.seatClosed";
function parentOf(seat: Seat, ids: Set<string>): string | null {
  if (seat.tier === "vp" && seat.id.startsWith("vp-")) {
    const head = `head-${seat.id.slice(3)}`;
    if (ids.has(head)) return head;
  }
  if (seat.tier === "pm" && seat.id.startsWith("pm-")) {
    const vp = `vp-${seat.id.slice(3)}`;
    if (ids.has(vp)) return vp;
    const head = `head-${seat.id.slice(3)}`;
    if (ids.has(head)) return head;
  }
  return null;
}

function tree(seats: readonly Seat[]): Node[] {
  const ids = new Set(seats.map((seat) => seat.id));
  const byParent = new Map<string | null, Seat[]>();
  for (const seat of seats) {
    const parent = parentOf(seat, ids);
    const key = parent && ids.has(parent) ? parent : null;
    const list = byParent.get(key);
    if (list) list.push(seat);
    else byParent.set(key, [seat]);
  }
  const visit = (parent: string | null): Node[] =>
    [...(byParent.get(parent) ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((seat) => ({ seat, folder: null, children: visit(seat.id) }));
  return visit(null);
}

function nodeKey(node: Node): string {
  return node.folder?.path ?? node.seat.id;
}

function rowName(node: Node): string {
  return node.folder?.name ?? folderName(node.seat.id);
}

/** Heads come from the folders on disk. A head with no folder keeps a row of its own. */
function folderTree(seats: readonly Seat[], folders: readonly SeatFolder[]): Node[] {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const kept = folders.filter((folder) => {
    const seat = byId.get(folder.seat);
    return Boolean(seat && managed.has(seat.tier) && !loose.has(seat.id));
  });
  const pm = new Set(seats.filter((seat) => seat.tier === "pm").map((seat) => seat.id));
  const visit = (folder: NestedSeatFolder): Node | null => {
    const seat = byId.get(folder.seat);
    if (!seat) return null;
    const children = folder.children.flatMap((child) => {
      const node = visit(child);
      return node ? [node] : [];
    });
    return { seat, folder, children };
  };
  const roots: Node[] = [];
  const placed = new Set<string>();
  const nested = nestSeatFolders(kept, pm);
  const heads = liveHeadFolders(nested.filter((folder) => byId.get(folder.seat)?.tier === "head"));
  for (const folder of heads) {
    const seat = byId.get(folder.seat);
    if (!seat || seat.tier !== "head") continue;
    const node = visit(folder);
    if (!node) continue;
    roots.push(node);
    placed.add(seat.id);
  }
  for (const seat of seats) {
    if (seat.tier !== "head" || loose.has(seat.id) || placed.has(seat.id)) continue;
    roots.push({ seat, folder: null, children: [] });
  }
  roots.sort((left, right) => left.seat.id.localeCompare(right.seat.id));
  return roots;
}

const agentTreesKey = "boltrig.agentTrees";
const agentTreesEvent = "boltrig-agent-trees";

function seatsUnder(node: Node, into: Set<string>) {
  into.add(node.seat.id);
  for (const child of node.children) seatsUnder(child, into);
}

function publishHeadTrees(nodes: readonly Node[]) {
  const trees = nodes
    .filter((node) => node.seat.tier === "head")
    .map((node) => {
      const seats = new Set<string>();
      seatsUnder(node, seats);
      return { head: node.seat.id, seats: [...seats] };
    });
  localStorage.setItem(agentTreesKey, JSON.stringify(trees));
  window.dispatchEvent(new Event(agentTreesEvent));
}

function folderName(id: string): string {
  const stem = id.replace(/^(?:head|vp|pm)-/, "");
  if (stem === id) return id === "vp" || id === "pm" ? id.toUpperCase() : title(id);
  return title(stem);
}

function title(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function roleLabel(seat: Seat): string {
  if (seat.tier === "head" && seat.id.startsWith("head-")) return `Head of ${folderName(seat.id)}`;
  if (seat.tier === "vp") return "VP";
  if (seat.tier === "pm") return "PM";
  return folderName(seat.id);
}

function markLetter(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || "?";
}

function tone(id: string): string {
  return seatTone(id);
}

function matches(node: Node, key: string): boolean {
  return nodeKey(node) === key || node.seat.id === key;
}

function holds(node: Node, key: string): boolean {
  if (matches(node, key)) return true;
  return node.children.some((child) => holds(child, key));
}

function headKeyFor(nodes: readonly Node[], key: string | null): string | null {
  if (!key) return null;
  for (const node of nodes) {
    if (node.seat.tier === "head" && holds(node, key)) return nodeKey(node);
  }
  return null;
}

function ancestorKeys(nodes: readonly Node[], key: string): string[] {
  const walk = (node: Node, trail: string[]): string[] | null => {
    if (matches(node, key)) return trail;
    const next = [...trail, nodeKey(node)];
    for (const child of node.children) {
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  for (const node of nodes) {
    const found = walk(node, []);
    if (found) return found;
  }
  return [];
}

/** One head stays open: the one that holds `key`, plus the folders above that row. */
function withOnlyHead(nodes: readonly Node[], open: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(open);
  const head = headKeyFor(nodes, key);
  for (const node of nodes) {
    if (node.seat.tier === "head" && nodeKey(node) !== head) next.delete(nodeKey(node));
  }
  if (head) next.add(head);
  for (const ancestor of ancestorKeys(nodes, key)) next.add(ancestor);
  return next;
}

function closedFolders(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(closedKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function rememberClosed(seatId: string, closed: boolean) {
  const folders = closedFolders();
  if (closed) folders.add(seatId);
  else folders.delete(seatId);
  localStorage.setItem(closedKey, JSON.stringify([...folders]));
}

function writeMode(seatId: string) {
  const next = (raw: string | null): string => {
    let current: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw ?? "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch {
      current = {};
    }
    return JSON.stringify({ ...current, mode: seatId });
  };
  const apply = (storage: Storage) => {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("bb.promptbox.session-options-")) keys.push(key);
    }
    if (keys.length === 0) {
      keys.push(`bb.promptbox.session-options-${encodeURIComponent("acp-opencode")}-1`);
    }
    for (const key of keys) storage.setItem(key, next(storage.getItem(key)));
  };
  apply(localStorage);
  apply(sessionStorage);
}

let pinnedSeat: string | null = null;

function pinSeatName(seatId: string) {
  pinnedSeat = seatId;
  paintSeatName();
}

function seatLabel(): HTMLElement {
  const existing = document.body.querySelector(":scope > [data-seat-name]");
  if (existing instanceof HTMLElement) return existing;
  const label = document.createElement("span");
  label.dataset.seatName = "true";
  document.body.appendChild(label);
  return label;
}

function paintSeatName() {
  const seatId = pinnedSeat ?? sessionStorage.getItem(activeKey);
  if (!seatId) return;
  pinnedSeat = seatId;
  const label = seatLabel();
  if (label.textContent !== seatId) label.textContent = seatId;
  const agent = document.querySelector('button[aria-label="Agent options"]');
  const anchor = agent ?? document.querySelector('button[aria-label="Permission mode"]');
  if (!(anchor instanceof HTMLElement)) {
    label.hidden = true;
    return;
  }
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    label.hidden = true;
    return;
  }
  label.hidden = false;
  if (agent instanceof HTMLElement) {
    label.style.left = `${rect.left}px`;
    label.style.top = `${rect.top}px`;
    label.style.width = `${rect.width}px`;
    label.style.height = `${rect.height}px`;
    return;
  }
  label.style.width = "auto";
  label.style.height = `${rect.height}px`;
  label.style.top = `${rect.top}px`;
  const width = label.offsetWidth;
  label.style.left = `${Math.max(8, rect.left - width - 8)}px`;
}

const COMPOSER_BAR_STYLE = `
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-editor-scroll] {
  min-height: calc(1.7em + 16px) !important;
  max-height: calc(1.7em * 17 + 16px) !important;
  height: auto !important;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
  padding-left: 32px !important;
}
[data-promptbox]:not([data-promptbox-compact]) button[aria-label="Prompt actions"] {
  position: absolute !important;
  left: -2px !important;
  bottom: 46px !important;
  z-index: 3;
  width: 20px !important;
  height: 20px !important;
  min-width: 0 !important;
  padding: 0 !important;
  color: #737373 !important;
}
[data-promptbox]:not([data-promptbox-compact]) button[aria-label="Prompt actions"] svg {
  color: #737373 !important;
}
[data-promptbox-compact] [data-promptbox-editor-scroll] {
  min-height: 48px !important;
  max-height: 48px !important;
  height: 48px !important;
}
[data-testid="root-compose-compact-home"]:not(:has([data-testid="root-compose-compact-scroll-viewport"])) {
  height: 100%;
  min-height: 100%;
  justify-content: flex-end;
}
[data-testid="root-compose-compact-home"]:not(:has([data-testid="root-compose-compact-scroll-viewport"])) > :not([data-testid="root-compose-compact-composer"]) {
  display: none;
}
[data-promptbox-shell]:has([data-new-thread-footer]),
[data-follow-up-composer] {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--background);
}
[data-promptbox-shell]:has([data-new-thread-footer]) [data-promptbox],
[data-follow-up-composer] [data-promptbox] {
  border: none !important;
  box-shadow: none !important;
  background: transparent !important;
}
[data-new-thread-footer],
[data-follow-up-composer-footer] {
  margin-top: 0 !important;
}
button[aria-label="Agent options"] {
  visibility: hidden !important;
}
body > [data-seat-name] {
  position: fixed;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding-inline: 8px;
  overflow: hidden;
  color: var(--foreground);
  font-size: 13px;
  line-height: 28px;
  white-space: nowrap;
  opacity: 1;
  pointer-events: none;
}
@media (max-width: 767px) {
  [data-sidebar="panel"] {
    width: 100vw !important;
    max-width: 100vw !important;
    border-right-width: 0 !important;
  }
  [data-sidebar="panel"] [data-testid="nav-rail-sidebar-body"],
  [data-sidebar="panel"] [data-testid="sidebar-footer-body"] {
    grid-column: 1 / -1 !important;
    width: 100% !important;
  }
  [data-sidebar="panel"] [data-testid="nav-rail-sidebar-body"] {
    padding-bottom: calc(80px + env(safe-area-inset-bottom));
  }
  [data-sidebar="panel"] [data-testid="sidebar-footer-body"] {
    display: none !important;
  }
  [data-sidebar="panel"] nav[aria-label="Seats"] .h-7 {
    height: 44px !important;
    font-size: 17px !important;
  }
  [data-sidebar="panel"] nav[aria-label="Seats"] .text-\\[11px\\] {
    font-size: 13px !important;
  }
  [data-sidebar="panel"] button[aria-label^="New thread"] {
    height: 44px !important;
    font-size: 17px !important;
  }
  [data-sidebar="panel"] nav[aria-label="Seats"] button[aria-expanded] {
    width: 32px !important;
    height: 32px !important;
  }
  [data-sidebar="panel"] .grid > div:has([data-testid="app-nav-rail"]) {
    width: 0 !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: transparent !important;
  }
  [data-sidebar="panel"] [data-testid="app-nav-rail"] {
    position: absolute !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-sidebar="panel"][data-state="open"] .grid > div:has(button[aria-label^="Settings"]) {
    display: none !important;
  }
  body > [data-phone-rail] {
    position: fixed;
    z-index: 80;
    left: 12px;
    right: 12px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 8px;
    border-radius: 28px;
    background: color-mix(in oklab, var(--sidebar, var(--background)) 72%, transparent);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    backdrop-filter: blur(28px) saturate(1.6);
    box-shadow:
      inset 0 0 0 0.5px color-mix(in oklab, white 36%, transparent),
      0 10px 28px color-mix(in oklab, black 28%, transparent);
  }
  body > [data-phone-rail] > button {
    display: inline-flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    height: 48px;
    min-width: 0;
    padding: 0;
    color: var(--foreground);
    background: transparent;
    border: 0;
    border-radius: 0;
    touch-action: none;
  }
  body > [data-phone-rail] [data-phone-glyph] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 16px;
  }
  body > [data-phone-rail] > button[aria-current="page"] [data-phone-glyph],
  body > [data-phone-rail] > button[aria-expanded="true"] [data-phone-glyph],
  body > [data-phone-rail] > button:active [data-phone-glyph] {
    background: color-mix(in oklab, var(--foreground) 14%, transparent);
  }
  body > [data-phone-menu] {
    position: fixed;
    z-index: 81;
    left: calc(12px + (100vw - 24px) * 0.1);
    width: calc((100vw - 24px) * 0.66);
    bottom: calc(72px + env(safe-area-inset-bottom));
    max-height: min(440px, 62vh);
    display: flex;
    flex-direction: column;
    padding: 6px;
    overflow: hidden;
    color: var(--foreground);
    background: color-mix(in oklab, var(--sidebar, var(--background)) 86%, transparent);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    backdrop-filter: blur(24px) saturate(1.5);
    border-radius: 16px;
    box-shadow:
      inset 0 0 0 0.5px color-mix(in oklab, white 32%, transparent),
      0 16px 40px color-mix(in oklab, black 36%, transparent);
    transform-origin: 90% 100%;
    transition: transform 180ms ease, opacity 180ms ease;
  }
  body > [data-phone-menu][data-closed="true"] {
    opacity: 0;
    pointer-events: none;
    transform: translateY(16px) scale(0.96);
  }
  body > [data-phone-menu][data-dragging="true"] {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    body > [data-phone-menu] {
      transition: none;
    }
    body > [data-phone-menu][data-closed="true"] {
      transform: none;
    }
  }
  body > [data-phone-menu] [data-phone-grab] {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 6px auto 8px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--foreground) 28%, transparent);
    touch-action: none;
  }
  body > [data-phone-menu] [data-phone-menu-list] {
    overflow: auto;
  }
  body > [data-phone-menu] p {
    margin: 0;
    padding: 4px 12px 8px;
    font-size: 13px;
    color: var(--muted-foreground, var(--foreground));
  }
  body > [data-phone-menu] [data-phone-menu-head] {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 2px 6px 6px 12px;
  }
  body > [data-phone-menu] [data-phone-workspace] {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 560;
  }
  body > [data-phone-menu] button[data-phone-settings] {
    width: 36px;
    height: 36px;
    flex: none;
    justify-content: center;
    padding: 0;
  }
  body > [data-phone-menu] button {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    height: 44px;
    padding: 0 12px;
    color: inherit;
    font-size: 15px;
    text-align: start;
    background: transparent;
    border: 0;
    border-radius: 12px;
  }
  body > [data-phone-menu] button:active {
    background: color-mix(in oklab, var(--foreground) 12%, transparent);
  }
  body > [data-phone-menu] [data-phone-glyph] {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
  }
  body > [data-phone-rail] svg,
  body > [data-phone-rail] [data-icon-root],
  body > [data-phone-menu] svg,
  body > [data-phone-menu] [data-icon-root] {
    width: 26px !important;
    height: 26px !important;
    display: block !important;
    flex: none;
  }
  body > [data-phone-menu] button span[data-phone-name] {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  body > [data-phone-menu] button[aria-pressed="true"],
  body > [data-phone-menu] button[aria-current="page"] {
    background: color-mix(in oklab, var(--foreground) 10%, transparent);
  }
  body > [data-phone-menu] [data-phone-mark] {
    font-size: 13px;
    opacity: 0.7;
  }
}
[data-sidebar="panel"] {
  background: oklch(0.94 0 0) !important;
}
aside:has([data-testid="thread-secondary-panel-top-chrome"]),
aside:has([data-testid="thread-secondary-panel-top-chrome"]) .bg-sidebar {
  background-color: var(--background) !important;
}
[data-markdown-preview] p,
[data-markdown-preview] ul,
[data-markdown-preview] ol,
[data-markdown-preview] blockquote,
[data-markdown-preview] pre {
  margin-bottom: 20px !important;
}
[data-markdown-preview] p:last-child,
[data-markdown-preview] ul:last-child,
[data-markdown-preview] ol:last-child,
[data-markdown-preview] blockquote:last-child,
[data-markdown-preview] pre:last-child {
  margin-bottom: 0 !important;
}
[data-timeline-row-list="top-level"] > [data-timeline-items],
[data-timeline-row-list="nested"] > [data-timeline-items] {
  gap: 20px !important;
}
[data-thread-split="open"] {
  position: relative;
}
[data-thread-split="open"] div:has(> header [data-thread-header-pane-actions]) {
  padding-top: var(--bb-app-chrome-row-height);
}
[data-thread-split="open"] header:has([data-thread-header-pane-actions]) {
  position: absolute !important;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 30;
}
[data-thread-split="open"] aside:has([data-testid="thread-secondary-panel-top-chrome"]) {
  top: var(--bb-app-chrome-row-height) !important;
  height: calc(100% - var(--bb-app-chrome-row-height)) !important;
}
[data-thread-header-pane-actions] > button[aria-label^="Show right panel"],
[data-thread-header-pane-actions] > button[aria-label^="Hide right panel"] {
  display: inline-flex !important;
}
nav[aria-label="Seats"] [data-indent-guide] {
  opacity: 0;
}
nav[aria-label="Seats"] [data-indent-group]:not(:has([data-indent-group])) > [data-indent-guide] {
  opacity: 1;
}
nav[aria-label="Seats"]:hover [data-indent-guide] {
  opacity: 1;
}

`;

const phoneSidebarWidth = "100vw";
const deskSidebarWidth = "min(86vw, 360px)";

function fitPhoneSidebar() {
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const value = phone ? phoneSidebarWidth : deskSidebarWidth;
  document.querySelectorAll<HTMLElement>("[style*='sidebar-width-mobile']").forEach((node) => {
    if (node.style.getPropertyValue("--sidebar-width-mobile") !== value) {
      node.style.setProperty("--sidebar-width-mobile", value);
    }
  });
  fitPhoneRail(phone && document.querySelector('[data-sidebar="panel"][data-state="open"]') !== null);
  bindPhoneSwipe();
}

let phoneSwipeWrote = "";

function correctPhoneSwipe() {
  if (!window.matchMedia("(max-width: 767px)").matches) return;
  const inset = document.querySelector<HTMLElement>('[data-sidebar="inset"]');
  if (!inset || inset.getAttribute("data-vaul-animate") !== "false") return;
  const raw = inset.style.translate;
  if (!raw) {
    phoneSwipeWrote = "";
    return;
  }
  if (raw === phoneSwipeWrote) return;
  const current = Number.parseFloat(raw);
  const jsWidth = Math.min(window.innerWidth * 0.86, 360);
  const full = window.innerWidth;
  if (!Number.isFinite(current) || jsWidth <= 0 || Math.abs(full - jsWidth) < 1) return;
  const progress = Math.min(1, Math.max(0, current / jsWidth));
  const next = `${Math.round(full * progress)}px`;
  phoneSwipeWrote = next;
  inset.style.translate = next;
  const backdrop = document.querySelector<HTMLElement>("[data-sidebar-mobile-backdrop]");
  if (backdrop?.style.translate) backdrop.style.translate = next;
}

let phoneSwipeBound = false;

function bindPhoneSwipe() {
  if (phoneSwipeBound) return;
  phoneSwipeBound = true;
  const schedule = () => queueMicrotask(correctPhoneSwipe);
  const end = () => {
    schedule();
    fitPhoneSidebar();
  };
  window.addEventListener("pointermove", schedule);
  window.addEventListener("pointerup", end);
  window.addEventListener("touchmove", schedule, { passive: true });
  window.addEventListener("touchend", end);
}

const phoneSlotsKey = "boltrig.phoneRailMain";
const defaultPhoneSlots = ["Home", "Plugins", "Automations"];
const phoneSkip = new Set(["New thread", "Toggle sidebar", "Go back", "Go forward", "More sections", "Settings"]);
const phoneFooterKeep = new Set(["File tree", "Report a bug"]);
const phoneChevron = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M4 6.2 8 3.2 12 6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.8 8 12.8 12 9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const phonePlus = `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

interface PhoneControl {
  label: string;
  source: HTMLElement;
  icon: string;
  current: boolean;
}

let phoneWorkspaceName = "";
let phoneMenuMode: "list" | "customise" = "list";
let phoneMenuSignature = "";
let phoneDismissBound = false;

function controlLabel(node: HTMLElement): string {
  return (node.getAttribute("aria-label") || node.textContent || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim();
}

function phoneControls(): PhoneControl[] {
  const panel = document.querySelector('[data-sidebar="panel"]');
  if (!panel) return [];
  const nodes = [
    ...panel.querySelectorAll<HTMLElement>('[data-testid="app-nav-rail"] button'),
    ...panel.querySelectorAll<HTMLElement>('button[aria-label^="Settings"]'),
    ...[...panel.querySelectorAll<HTMLElement>('[data-testid="sidebar-footer-body"] button, [data-testid="sidebar-footer-body"] a')].filter((node) => phoneFooterKeep.has(controlLabel(node))),
  ];
  const seen = new Set<string>();
  const controls: PhoneControl[] = [];
  for (const node of nodes) {
    const label = controlLabel(node);
    if (!label || phoneSkip.has(label) || seen.has(label)) continue;
    seen.add(label);
    controls.push({
      label,
      source: node,
      icon: node.querySelector("[data-icon-root]")?.outerHTML ?? "",
      current: node.getAttribute("aria-current") === "page",
    });
  }
  return controls;
}

function readPhoneSlots(controls: PhoneControl[]): string[] {
  let stored: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(phoneSlotsKey) ?? "");
    if (Array.isArray(parsed)) stored = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    stored = [];
  }
  const known = new Set(controls.map((item) => item.label));
  const chosen: string[] = [];
  for (const label of [...stored, ...defaultPhoneSlots, ...controls.map((item) => item.label)]) {
    if (chosen.length >= 3) break;
    if (known.has(label) && !chosen.includes(label)) chosen.push(label);
  }
  return chosen;
}

function iconElement(icon: string): HTMLElement | null {
  if (!icon) return null;
  const holder = document.createElement("div");
  holder.innerHTML = icon;
  const element = holder.querySelector<HTMLElement>("[data-icon-root], svg");
  if (!element) return null;
  const mask = element.style.maskImage || element.style.getPropertyValue("mask-image");
  if (mask) {
    element.style.setProperty("-webkit-mask-image", mask);
    element.style.setProperty("-webkit-mask-size", "contain");
    element.style.setProperty("-webkit-mask-repeat", "no-repeat");
    element.style.setProperty("-webkit-mask-position", "center");
  }
  return element;
}

const phoneSliders = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="17" r="1.6" fill="currentColor"/></svg>`;

function phoneGlyph(iconHtml: string, fallback: string): HTMLSpanElement {
  const glyph = document.createElement("span");
  glyph.dataset.phoneGlyph = "true";
  const icon = iconElement(iconHtml);
  if (icon) glyph.append(icon);
  else glyph.textContent = fallback.slice(0, 1);
  return glyph;
}

function closePhoneMenu() {
  const menu = document.body.querySelector<HTMLElement>(":scope > [data-phone-menu]");
  const chevron = document.body.querySelector<HTMLElement>(":scope > [data-phone-rail] [data-phone-chevron]");
  if (menu) {
    menu.dataset.closed = "true";
    menu.dataset.dragging = "false";
    menu.style.transform = "";
    menu.setAttribute("aria-hidden", "true");
  }
  chevron?.setAttribute("aria-expanded", "false");
  if (phoneMenuMode !== "list") {
    phoneMenuMode = "list";
    phoneMenuSignature = "";
  }
}

function openPhoneMenu() {
  const menu = document.body.querySelector<HTMLElement>(":scope > [data-phone-menu]");
  const chevron = document.body.querySelector<HTMLElement>(":scope > [data-phone-rail] [data-phone-chevron]");
  if (!menu) return;
  menu.dataset.closed = "false";
  menu.setAttribute("aria-hidden", "false");
  chevron?.setAttribute("aria-expanded", "true");
}

function bindPhoneDrag(handle: HTMLElement, menu: HTMLElement, onTap: (() => void) | null) {
  let startY = 0;
  let moved = false;
  let tracking = false;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    tracking = true;
    moved = false;
    startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!tracking) return;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > 8) moved = true;
    if (startY - event.clientY > 12 && menu.dataset.closed === "true") openPhoneMenu();
    if (menu.dataset.closed === "true") return;
    const pull = Math.max(0, dy);
    menu.dataset.dragging = pull > 0 ? "true" : "false";
    menu.style.transform = pull > 0 ? `translateY(${pull}px)` : "";
  });
  const finish = () => {
    if (!tracking) return;
    tracking = false;
    const match = /translateY\(([-\d.]+)px\)/.exec(menu.style.transform);
    const pull = match ? Number(match[1]) : 0;
    menu.dataset.dragging = "false";
    menu.style.transform = "";
    if (!moved) {
      onTap?.();
      return;
    }
    if (menu.dataset.closed !== "true" && pull > 56) closePhoneMenu();
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

function phoneName(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.phoneName = "true";
  span.textContent = text;
  return span;
}

function phoneMenuRow(control: PhoneControl, marked: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.append(phoneGlyph(control.icon, control.label));
  button.append(phoneName(control.label));
  if (control.current && !marked) button.setAttribute("aria-current", "page");
  if (marked) {
    button.setAttribute("aria-pressed", "true");
    const mark = document.createElement("span");
    mark.dataset.phoneMark = "true";
    mark.textContent = "On";
    button.append(mark);
  }
  button.addEventListener("click", onClick);
  return button;
}

function paintPhoneMenuHead(menu: HTMLElement) {
  const name = menu.querySelector("[data-phone-workspace]");
  const label = phoneWorkspaceName || "Workspace";
  if (name && name.textContent !== label) name.textContent = label;
  const settings = menu.querySelector<HTMLButtonElement>("[data-phone-settings]");
  if (!settings || settings.dataset.ready === "true") return;
  const source = document.querySelector<HTMLElement>('[data-sidebar="panel"] button[aria-label^="Settings"]');
  settings.replaceChildren(phoneGlyph(source?.querySelector("[data-icon-root]")?.outerHTML ?? "", "Settings"));
  settings.dataset.ready = "true";
  settings.addEventListener("click", () => {
    closePhoneMenu();
    document.querySelector<HTMLButtonElement>('[data-sidebar="panel"] button[aria-label^="Settings"]')?.click();
  });
}

function paintPhoneRail(bar: HTMLElement, menu: HTMLElement) {
  paintPhoneMenuHead(menu);
  const controls = phoneControls();
  const slots = readPhoneSlots(controls);
  const byLabel = new Map(controls.map((item) => [item.label, item]));
  slots.forEach((label, index) => {
    const button = bar.querySelector<HTMLButtonElement>(`[data-phone-slot="${index}"]`);
    const control = byLabel.get(label);
    if (!button || !control) return;
    button.setAttribute("aria-label", control.label);
    if (control.current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    const stamp = `${control.label}|${control.current ? "1" : "0"}|${control.icon.length}`;
    if (button.dataset.phoneStamp !== stamp) {
      button.dataset.phoneStamp = stamp;
      button.replaceChildren(phoneGlyph(control.icon, control.label));
    }
    button.onclick = () => {
      closePhoneMenu();
      control.source.click();
    };
  });
  const signature = `${phoneMenuMode}|${slots.join("\u0000")}|${controls.map((item) => `${item.label}:${item.current ? "1" : "0"}`).join("\u0000")}`;
  if (signature === phoneMenuSignature) return;
  phoneMenuSignature = signature;
  const list = menu.querySelector<HTMLElement>("[data-phone-menu-list]");
  if (!list) return;
  list.replaceChildren();
  if (phoneMenuMode === "customise") {
    const note = document.createElement("p");
    note.textContent = "Three icons stay on the bar. Tap another to replace the oldest.";
    list.append(note);
    for (const control of controls) {
      const on = slots.includes(control.label);
      list.append(phoneMenuRow(control, on, () => {
        if (on) return;
        const next = slots.length < 3 ? [...slots, control.label] : [...slots.slice(1), control.label];
        writePhoneSlots(next);
        phoneMenuSignature = "";
        paintPhoneRail(bar, menu);
      }));
    }
    return;
  }
  for (const control of controls) {
    if (slots.includes(control.label)) continue;
    list.append(phoneMenuRow(control, false, () => {
      closePhoneMenu();
      control.source.click();
    }));
  }
  const customise = document.createElement("button");
  customise.type = "button";
  customise.append(phoneGlyph(phoneSliders, "Customise"), phoneName("Customise"));
  customise.addEventListener("click", () => {
    phoneMenuMode = "customise";
    phoneMenuSignature = "";
    paintPhoneRail(bar, menu);
  });
  list.append(customise);
}

function writePhoneSlots(slots: string[]) {
  localStorage.setItem(phoneSlotsKey, JSON.stringify(slots.slice(0, 3)));
}

function ensurePhoneChrome(): { bar: HTMLElement; menu: HTMLElement } | null {
  const existingBar = document.body.querySelector<HTMLElement>(":scope > [data-phone-rail]");
  const existingMenu = document.body.querySelector<HTMLElement>(":scope > [data-phone-menu]");
  if (existingBar && existingMenu) return { bar: existingBar, menu: existingMenu };
  existingBar?.remove();
  existingMenu?.remove();
  const bar = document.createElement("div");
  bar.dataset.phoneRail = "true";
  for (let index = 0; index < 3; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.phoneSlot = String(index);
    bar.append(button);
  }
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.dataset.phoneChevron = "true";
  chevron.setAttribute("aria-label", "More sections");
  chevron.setAttribute("aria-expanded", "false");
  chevron.innerHTML = `<span data-phone-glyph="true">${phoneChevron}</span>`;
  bar.append(chevron);
  const newer = document.createElement("button");
  newer.type = "button";
  newer.dataset.phoneNew = "true";
  newer.setAttribute("aria-label", "New thread");
  newer.innerHTML = `<span data-phone-glyph="true">${phonePlus}</span>`;
  newer.addEventListener("click", () => {
    closePhoneMenu();
    document.querySelector<HTMLButtonElement>('[data-sidebar="panel"] button[aria-label^="New thread"]')?.click();
  });
  bar.append(newer);
  const menu = document.createElement("div");
  menu.dataset.phoneMenu = "true";
  menu.dataset.closed = "true";
  menu.setAttribute("aria-hidden", "true");
  const grab = document.createElement("div");
  grab.dataset.phoneGrab = "true";
  const head = document.createElement("div");
  head.dataset.phoneMenuHead = "true";
  const workspace = document.createElement("span");
  workspace.dataset.phoneWorkspace = "true";
  const settings = document.createElement("button");
  settings.type = "button";
  settings.dataset.phoneSettings = "true";
  settings.setAttribute("aria-label", "Settings");
  head.append(workspace, settings);
  const list = document.createElement("div");
  list.dataset.phoneMenuList = "true";
  menu.append(grab, head, list);
  bindPhoneDrag(chevron, menu, () => {
    if (menu.dataset.closed === "true") openPhoneMenu();
    else closePhoneMenu();
  });
  bindPhoneDrag(grab, menu, null);
  if (!phoneDismissBound) {
    phoneDismissBound = true;
    document.addEventListener("pointerdown", (event) => {
      const liveMenu = document.body.querySelector<HTMLElement>(":scope > [data-phone-menu]");
      const liveBar = document.body.querySelector<HTMLElement>(":scope > [data-phone-rail]");
      if (!liveMenu || liveMenu.dataset.closed === "true") return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (liveBar?.contains(target) || liveMenu.contains(target)) return;
      closePhoneMenu();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !event.isTrusted) return;
      const liveMenu = document.body.querySelector<HTMLElement>(":scope > [data-phone-menu]");
      if (!liveMenu || liveMenu.dataset.closed === "true") return;
      closePhoneMenu();
    });
  }
  document.body.append(bar, menu);
  return { bar, menu };
}

function fitPhoneRail(show: boolean) {
  if (!show) {
    document.body.querySelector(":scope > [data-phone-rail]")?.remove();
    document.body.querySelector(":scope > [data-phone-menu]")?.remove();
    phoneMenuMode = "list";
    phoneMenuSignature = "";
    return;
  }
  const chrome = ensurePhoneChrome();
  if (!chrome) return;
  paintPhoneRail(chrome.bar, chrome.menu);
}

function ensureComposerBar() {
  let style = document.querySelector("[data-seat-composer-bar]");
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.dataset.seatComposerBar = "true";
    document.head.appendChild(style);
  }
  if (style.textContent !== COMPOSER_BAR_STYLE) style.textContent = COMPOSER_BAR_STYLE;
}

const paneInfoIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="currentColor" data-icon="Info" data-icon-root="" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></circle><path d="M12 16v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M12 8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`;

function paintPaneInfoIcon() {
  const button = document.querySelector(
    '[data-thread-header-pane-actions] > button[aria-label^="Show right panel"], [data-thread-header-pane-actions] > button[aria-label^="Hide right panel"]',
  );
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.remove("hidden");
  if (button.hasAttribute("inert")) button.removeAttribute("inert");
  const icon = button.querySelector("svg");
  if (icon instanceof SVGElement && icon.dataset.icon !== "Info") icon.outerHTML = paneInfoIcon;
}

function placePanelUnderHeader() {
  const header = document.querySelector("header:has([data-thread-header-pane-actions])");
  const aside = document.querySelector('aside:has([data-testid="thread-secondary-panel-top-chrome"])');
  const marked = document.querySelector("[data-thread-split]");
  if (!(header instanceof HTMLElement) || !(aside instanceof HTMLElement)) {
    if (marked instanceof HTMLElement) delete marked.dataset.threadSplit;
    return;
  }
  const parents = new Set<Element>();
  for (let node = header.parentElement; node; node = node.parentElement) parents.add(node);
  let common: Element | null = aside.parentElement;
  while (common && !parents.has(common)) common = common.parentElement;
  if (!(common instanceof HTMLElement)) return;
  if (marked instanceof HTMLElement && marked !== common) delete marked.dataset.threadSplit;
  if (common.dataset.threadSplit !== "open") common.dataset.threadSplit = "open";
}

let paneInfoWatching = false;
let paintingPane = false;

function watchPaneInfoIcon() {
  const paint = () => {
    if (paintingPane) return;
    paintingPane = true;
    try {
      paintPaneInfoIcon();
      placePanelUnderHeader();
    } finally {
      paintingPane = false;
    }
  };
  paint();
  if (paneInfoWatching) return;
  paneInfoWatching = true;
  const observer = new MutationObserver(() => paint());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

function remembered(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(rememberedKey) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const owner = new Map<string, string>();
    for (const [seatId, value] of Object.entries(parsed)) {
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0) owner.set(id, seatId);
      }
    }
    const threads: Record<string, string[]> = {};
    for (const [threadId, seatId] of owner) {
      const ids = threads[seatId] ?? [];
      ids.push(threadId);
      threads[seatId] = ids;
    }
    return threads;
  } catch {
    return {};
  }
}

const workspaceCache = new Map<string, Promise<{ projectId: string; hostId: string; environmentId?: string; own: boolean } | null>>();
const seatForKey = new Map<string, string>();
const tierForKey = new Map<string, string>();

function publishTier(tier: string | null) {
  const current = sessionStorage.getItem(tierKey);
  if (current === tier) return;
  if (tier) sessionStorage.setItem(tierKey, tier);
  else sessionStorage.removeItem(tierKey);
  window.dispatchEvent(new Event("boltrig-seat-tier"));
}

function indexNodes(list: readonly Node[]) {
  seatForKey.clear();
  tierForKey.clear();
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      seatForKey.set(nodeKey(node), node.seat.id);
      tierForKey.set(nodeKey(node), node.seat.tier);
      walk(node.children);
    }
  };
  walk(list);
}

function rememberThread(seatId: string, threadId: string) {
  const threads = remembered();
  for (const [id, list] of Object.entries(threads)) {
    const kept = list.filter((item) => item !== threadId);
    if (kept.length > 0) threads[id] = kept;
    else delete threads[id];
  }
  const ids = threads[seatId] ?? [];
  ids.push(threadId);
  threads[seatId] = ids.slice(-12);
  localStorage.setItem(rememberedKey, JSON.stringify(threads));
}

function latestThread(seatId: string): string | undefined {
  const ids = remembered()[seatId];
  return ids?.[ids.length - 1];
}

let clickToken = 0;
let chooseTimer = 0;

function chooseAgent(seatId: string, token: number) {
  window.clearTimeout(chooseTimer);
  let attempt = 0;
  const pick = () => {
    if (token !== clickToken) return;
    writeMode(seatId);
    pinSeatName(seatId);
    const button = document.querySelector('button[aria-label="Agent options"]');
    if (!(button instanceof HTMLButtonElement)) {
      attempt += 1;
      if (attempt < 8) chooseTimer = window.setTimeout(pick, 80);
      return;
    }
    if (button.textContent?.includes(seatId)) return;
    button.disabled = false;
    button.click();
    chooseTimer = window.setTimeout(() => {
      if (token !== clickToken) return;
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent?.includes(seatId));
      if (item instanceof HTMLElement) item.click();
      paintSeatName();
    }, 80);
  };
  chooseTimer = window.setTimeout(pick, 280);
}

const treePad = 4;
const treeIndent = 12;

function sidePad(depth: number): CSSProperties {
  return { paddingLeft: treePad + depth * treeIndent };
}

function Guide({ depth }: { depth: number }) {
  return (
    <span
      aria-hidden
      data-indent-guide=""
      className="pointer-events-none absolute bottom-0 top-0 w-px"
      style={{
        left: treePad + (depth - 1) * treeIndent + 8,
        zIndex: 1,
        background: "color-mix(in oklab, var(--foreground) 22%, transparent)",
      }}
    />
  );
}

function SeatRow({
  selected, depth, children,
}: {
  selected: boolean;
  depth: number;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-[13px] hover:bg-state-hover"
      style={{
        ...sidePad(depth),
        userSelect: "none",
        ...(selected ? { background: "var(--state-active)" } : {}),
      }}
    >
      {children}
    </div>
  );
}

function FoldMark({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 shrink-0 border-b border-r border-current"
      style={{ transform: open ? "rotate(45deg)" : "rotate(-45deg)", marginBottom: open ? 2 : 0 }}
    />
  );
}

function Disclose({
  name, expanded, present, onClick,
}: {
  name: string;
  expanded: boolean;
  present: boolean;
  onClick: () => void;
}) {
  if (!present) return <span className="size-4 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
      onClick={onClick}
      className={`flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:text-foreground ${focusRing}`}
      style={{ ...quietButton, color: undefined }}
    >
      <FoldMark open={expanded} />
    </button>
  );
}

function Mark({ name, seatId }: { name: string; seatId: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-2xs font-medium leading-none text-white"
      style={{ backgroundColor: tone(seatId) }}
    >
      {markLetter(name)}
    </span>
  );
}

const quietButton: CSSProperties = {
  background: "transparent",
  border: 0,
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
};

export function SeatSidebar({ onNavigate, activeThreadId }: PluginThreadListProps) {
  const rpc = useRpc<typeof agentEditorRpc>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [currentThread, setCurrentThread] = useState<string | null>(null);
  const [onHome, setOnHome] = useState(false);
  const [activeSeat, setActiveSeat] = useState<string | null>(() => sessionStorage.getItem(activeKey));
  const [activeFolder, setActiveFolder] = useState<string | null>(() => sessionStorage.getItem(folderKey));

  useEffect(() => {
    void Promise.all([
      rpc.call("seats", null),
      rpc.call("folders", null).catch(() => ({ folders: [] as SeatFolder[], company: "" })),
    ]).then(([result, homes]) => {
      phoneWorkspaceName = homes.company;
      const seats = result.seats.filter((seat) => managed.has(seat.tier) && !loose.has(seat.id));
      const next = homes.folders.length > 0 ? folderTree(seats, homes.folders) : tree(seats);
      indexNodes(next);
      publishHeadTrees(next);
      const active = sessionStorage.getItem(folderKey) ?? sessionStorage.getItem(activeKey);
      setNodes(next);
      setOpen(active ? withOnlyHead(next, new Set(), active) : new Set());
      setReady(true);
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
      setReady(true);
    });
  }, [rpc]);

  useEffect(() => {
    const key = activeFolder ?? activeSeat;
    if (!key) return;
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector(`[data-seat-row="${CSS.escape(key)}"]`);
      if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSeat, activeFolder]);

  useEffect(() => {
    ensureComposerBar();
    watchPaneInfoIcon();
    paintSeatName();
    fitPhoneSidebar();
    const onMove = () => {
      paintSeatName();
      fitPhoneSidebar();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      paintSeatName();
      fitPhoneSidebar();
      const pending = sessionStorage.getItem(pendingKey);
      const match = window.location.pathname.match(/\/threads\/([^/]+)/);
      const threadId = match?.[1] ? decodeURIComponent(match[1]) : null;
      const home = window.location.pathname === "/";
      setCurrentThread((current) => current === threadId ? current : threadId);
      setOnHome((current) => current === home ? current : home);
      if (threadId) {
        const owner = Object.entries(remembered()).find((entry) => entry[1].includes(threadId))?.[0] ?? null;
        if (owner) {
          const seatId = seatForKey.get(owner);
          if (seatId) {
            sessionStorage.setItem(activeKey, seatId);
            if (owner === seatId) sessionStorage.removeItem(folderKey);
            else sessionStorage.setItem(folderKey, owner);
            setActiveSeat((current) => current === seatId ? current : seatId);
            setActiveFolder(owner === seatId ? null : owner);
            pinSeatName(seatId);
            publishTier(tierForKey.get(owner) ?? null);
          }
        } else if (!sessionStorage.getItem(pendingKey)) {
          publishTier(null);
        }
      } else if (!sessionStorage.getItem(pendingKey)) {
        publishTier(null);
      }
      const left = sessionStorage.getItem(leftKey);
      if (!pending || !threadId || (left && threadId === left)) return;
      rememberThread(pending, threadId);
      sessionStorage.removeItem(pendingKey);
      sessionStorage.removeItem(leftKey);
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  const currentKey = (): string | null => {
    const visible = activeThreadId ?? currentThread;
    if (visible) {
      const owner = Object.entries(remembered()).find((entry) => entry[1].includes(visible))?.[0] ?? null;
      if (owner && seatForKey.has(owner)) return owner;
    }
    if (!onHome) return null;
    return activeFolder ?? activeSeat;
  };
  const shown = (node: Node): boolean => currentKey() === nodeKey(node);

  const seenHead = useRef<string | null>(null);
  useEffect(() => {
    const key = currentKey();
    if (!key || nodes.length === 0) return;
    const head = headKeyFor(nodes, key);
    if (!head) return;
    if (head !== seenHead.current) {
      seenHead.current = head;
      setOpen((current) => withOnlyHead(nodes, current, key));
      return;
    }
    setOpen((current) => {
      const next = new Set(current);
      let changed = false;
      for (const node of nodes) {
        if (node.seat.tier === "head" && nodeKey(node) !== head && next.delete(nodeKey(node))) changed = true;
      }
      return changed ? next : current;
    });
  }, [nodes, activeFolder, activeSeat, currentThread, onHome, activeThreadId]);

  const toggle = (key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      const closing = next.has(key);
      if (closing) next.delete(key);
      else {
        const openingHead = nodes.some((node) => node.seat.tier === "head" && nodeKey(node) === key);
        if (openingHead) {
          for (const node of nodes) {
            if (node.seat.tier === "head" && nodeKey(node) !== key) next.delete(nodeKey(node));
          }
          seenHead.current = key;
        }
        next.add(key);
      }
      rememberClosed(key, closing);
      return next;
    });
  };

  const workspaceForSeat = (seatId: string) => {
    const cached = workspaceCache.get(seatId);
    if (cached) return cached;
    const pending = (async () => {
      const home = await rpc.call("home", { seat: seatId });
      if (!home.path || !home.name) return null;
      const listed = await sdk.projects.list({});
      const projects = Array.isArray(listed) ? listed : [];
      const existing = projects.find((project) =>
        project.sources?.some((source) => source.path === home.path) || project.name === home.name,
      );
      const hostId = existing?.sources?.find((source) => source.hostId)?.hostId
        ?? projects.flatMap((project) => project.sources ?? []).find((source) => source.hostId)?.hostId
        ?? "";
      const projectId = existing?.id ?? (hostId
        ? (await sdk.projects.create({
          name: home.name,
          source: { hostId, type: "local_path", path: home.path },
        })).id
        : null);
      if (!projectId) return null;
      let environmentId: string | undefined;
      try {
        const environments = await sdk.environments.list({ projectId, path: home.path });
        environmentId = environments.find((environment) => environment.path === home.path)?.id;
      } catch {
        environmentId = undefined;
      }
      return { projectId, hostId, own: home.own, ...(environmentId ? { environmentId } : {}) };
    })();
    workspaceCache.set(seatId, pending);
    void pending.then((value) => { if (!value) workspaceCache.delete(seatId); }, () => workspaceCache.delete(seatId));
    return pending;
  };

  const workspaceForPath = (folderPath: string, name: string) => {
    const cached = workspaceCache.get(folderPath);
    if (cached) return cached;
    const pending = (async () => {
      const listed = await sdk.projects.list({});
      const projects = Array.isArray(listed) ? listed : [];
      const existing = projects.find((project) => project.sources?.some((source) => source.path === folderPath));
      const hostId = existing?.sources?.find((source) => source.hostId)?.hostId
        ?? projects.flatMap((project) => project.sources ?? []).find((source) => source.hostId)?.hostId
        ?? "";
      const projectId = existing?.id ?? (hostId
        ? (await sdk.projects.create({
          name,
          source: { hostId, type: "local_path", path: folderPath },
        })).id
        : null);
      if (!projectId) return null;
      let environmentId: string | undefined;
      try {
        const environments = await sdk.environments.list({ projectId, path: folderPath });
        environmentId = environments.find((environment) => environment.path === folderPath)?.id;
      } catch {
        environmentId = undefined;
      }
      return { projectId, hostId, own: true, ...(environmentId ? { environmentId } : {}) };
    })();
    workspaceCache.set(folderPath, pending);
    void pending.then((value) => { if (!value) workspaceCache.delete(folderPath); }, () => workspaceCache.delete(folderPath));
    return pending;
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      const label = button.getAttribute("aria-label") ?? "";
      if (!label.startsWith("New thread") || button.dataset.phoneNew === "true") return;
      const seatId = sessionStorage.getItem(activeKey);
      if (!seatId) return;
      event.preventDefault();
      event.stopPropagation();
      const folder = sessionStorage.getItem(folderKey);
      const key = folder || seatId;
      const token = ++clickToken;
      pinSeatName(seatId);
      publishTier(sessionStorage.getItem(tierKey));
      sessionStorage.setItem(pendingKey, key);
      const match = window.location.pathname.match(/\/threads\/([^/]+)/);
      sessionStorage.setItem(leftKey, match?.[1] ? decodeURIComponent(match[1]) : "");
      writeMode(seatId);
      const name = folder?.split("/").pop() || seatId;
      void (async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        if (token !== clickToken) return;
        const workspace = folder
          ? await workspaceForPath(folder, name).catch(() => null)
          : await workspaceForSeat(seatId).catch(() => null);
        if (token !== clickToken) return;
        navigate.toCompose({
          ...(workspace ? { projectId: workspace.projectId } : {}),
          ...(workspace?.environmentId ? { environmentId: workspace.environmentId } : {}),
          agent: seatId,
          focusPrompt: true,
        });
        let attempt = 0;
        const apply = () => {
          if (token !== clickToken) return;
          if (window.location.pathname === "/") {
            chooseAgent(seatId, token);
            return;
          }
          attempt += 1;
          if (attempt < 20) window.setTimeout(apply, 50);
        };
        window.setTimeout(apply, 50);
      })();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate, workspaceForPath, workspaceForSeat]);

  const openSeat = (node: Node) => {
    closePhoneMenu();
    const { seat, children } = node;
    const key = nodeKey(node);
    if (shown(node)) {
      if (children.length > 0) toggle(key);
      return;
    }
    setOpen((current) => {
      const next = withOnlyHead(nodes, current, key);
      if (children.length > 0) next.add(key);
      return next;
    });
    seenHead.current = headKeyFor(nodes, key);
    const token = ++clickToken;
    pinSeatName(seat.id);
    publishTier(seat.tier);
    sessionStorage.removeItem(pendingKey);
    onNavigate();
    sessionStorage.setItem(activeKey, seat.id);
    if (node.folder) sessionStorage.setItem(folderKey, node.folder.path);
    else sessionStorage.removeItem(folderKey);
    setActiveSeat(seat.id);
    setActiveFolder(node.folder?.path ?? null);
    const visible = activeThreadId ?? currentThread;
    const current = () => token === clickToken;
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      if (!current()) return;
      const workspace = node.folder
        ? await workspaceForPath(node.folder.path, node.folder.name).catch(() => null)
        : await workspaceForSeat(seat.id).catch(() => null);
      if (!current()) return;
      let threadId: string | null = null;
      if (workspace?.own) {
        const listed = await sdk.threads.list({ projectId: workspace.projectId, limit: 30 }).catch(() => []);
        if (!current()) return;
        const rows = Array.isArray(listed) ? listed : [];
        const roots = rows
          .filter((thread) => !thread.parentThreadId && thread.archivedAt == null)
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
        threadId = roots[0]?.id ?? null;
      }
      if (!threadId) {
        const rememberedId = latestThread(key);
        if (rememberedId) {
          const thread = await sdk.threads.get({ threadId: rememberedId }).catch(() => null);
          if (!current()) return;
          if (thread && thread.archivedAt == null && (!workspace?.own || thread.projectId === workspace.projectId)) {
            threadId = rememberedId;
          }
        }
      }
      if (!current()) return;
      if (threadId && threadId !== visible) {
        rememberThread(key, threadId);
        sessionStorage.removeItem(pendingKey);
        sessionStorage.removeItem(leftKey);
        navigate.toThread(threadId);
        void sdk.threads.update({ threadId, sessionOptions: { mode: seat.id } }).catch(() => undefined);
        return;
      }
      if (threadId) return;
      sessionStorage.setItem(pendingKey, key);
      sessionStorage.setItem(leftKey, visible ?? "");
      writeMode(seat.id);
      navigate.toCompose({
        ...(workspace ? { projectId: workspace.projectId } : {}),
        ...(workspace?.environmentId ? { environmentId: workspace.environmentId } : {}),
        agent: seat.id,
        focusPrompt: true,
      });
      let attempt = 0;
      const apply = () => {
        if (!current()) return;
        if (window.location.pathname === "/") {
          chooseAgent(seat.id, token);
          return;
        }
        attempt += 1;
        if (attempt < 20) window.setTimeout(apply, 50);
      };
      window.setTimeout(apply, 50);
    })();
  };

  const renderFolder = (node: Node, depth: number) => {
    const { seat, children } = node;
    const key = nodeKey(node);
    const selected = shown(node);
    const expanded = open.has(key);
    const name = rowName(node);
    const disclose = children.length > 0;
    return (
      <div key={key} data-seat-row={key}>
        <SeatRow selected={selected} depth={depth}>
          <Disclose name={name} expanded={expanded} present={disclose} onClick={() => toggle(key)} />
          <button
            type="button"
            onClick={() => openSeat(node)}
            aria-current={selected ? "page" : undefined}
            title={`${name} · ${seat.id}`}
            className={`min-w-0 flex-1 truncate text-left ${focusRing} ${selected ? "font-medium text-foreground" : "text-muted-foreground"}`}
            style={quietButton}
          >
            {name}
          </button>
          <span className="w-6 shrink-0 text-right text-[11px] text-muted-foreground">{roleLabel(seat)}</span>
        </SeatRow>
        {expanded && disclose ? (
          <div className="relative" data-indent-group="">
            <Guide depth={depth + 1} />
            {children.map((child) => renderFolder(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderHead = (node: Node) => {
    const { seat, children } = node;
    const key = nodeKey(node);
    const expanded = open.has(key);
    const selected = shown(node);
    const name = rowName(node);
    const role = roleLabel(seat);
    return (
      <div key={key} data-seat-row={key}>
        <SeatRow selected={selected} depth={0}>
          <Disclose
            name={name}
            expanded={expanded}
            present={children.length > 0}
            onClick={() => shown(node) ? toggle(key) : openSeat(node)}
          />
          <button
            type="button"
            onClick={() => openSeat(node)}
            aria-current={selected ? "page" : undefined}
            aria-label={[role, name].join(" · ")}
            title={`${role} · ${seat.id}`}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left ${focusRing}`}
            style={quietButton}
          >
            <Mark name={name} seatId={seat.id} />
            <span className="min-w-0 truncate">{name}</span>
          </button>
        </SeatRow>
        {expanded && children.length > 0 ? (
          <div role="group" aria-label={name} className="relative" data-indent-group="">
            <Guide depth={1} />
            {children.map((child) => renderFolder(child, 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <nav aria-label="Seats" className="flex flex-col py-1 text-sm">
      {nodes.length === 0 ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground">{status ?? (ready ? "No heads, VPs, or PMs are installed." : "Loading seats")}</p>
      ) : nodes.map((node) => node.seat.tier === "head" ? renderHead(node) : renderFolder(node, 0))}
    </nav>
  );
}

function threadTitle(thread: { title?: string | null; titleFallback?: string | null }): string {
  const title = thread.title?.trim() || thread.titleFallback?.trim();
  return title || "Untitled thread";
}

/** The seat's other threads, beside the open chat. The sidebar stays the seats. */
export function SeatThreads({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [rows, setRows] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const seatId = Object.entries(remembered()).find((entry) => entry[1].includes(threadId))?.[0];
    const others = seatId ? (remembered()[seatId] ?? []).filter((id) => id !== threadId) : [];
    if (others.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void Promise.all(others.map(async (id) => {
      try {
        const thread = await sdk.threads.get({ threadId: id });
        return { id, title: threadTitle(thread) };
      } catch {
        return null;
      }
    })).then((loaded) => {
      if (!cancelled) setRows(loaded.filter((row): row is { id: string; title: string } => row !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, sdk]);

  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" onClick={() => navigate.toThread(row.id)} className={`flex h-7 w-full cursor-pointer items-center truncate rounded-md px-2 text-left text-[13px] text-foreground hover:bg-state-hover ${focusRing}`} style={{ userSelect: "none" }}>
            {row.title}
          </button>
        </li>
      ))}
    </ul>
  );
}
