import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useBbNavigate, useRpc, useSdk, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { agentEditorRpc } from "./server.js";
import { focusRing, seatTone } from "./chrome.js";
import { homeRows, type SeatFolder } from "./seat-folders.js";

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
 * - The seat name is drawn over the composer, not inserted into it. The page is not watched for every change. A burst of seat clicks changes the composer once, after the clicks settle. The agent menu is not closed with Escape. The list says it is loading until the seats arrive. A row's name cannot be dragged into a selection. The phone menu does not animate when motion is reduced. A seat name and its fold show a focus ring from the keyboard. The fold mark darkens when the pointer or the keyboard is on it. The threads beside the chat use the same row size as the seats. The fold mark sits at the end of the row. A failed list can be tried again. The open row stays clear of the phone bar. A seat row darkens while it is pressed. A long thread name beside the chat can be read on hover. The fold mark stays still when motion is reduced. The update control stays in Settings. Each seat row is inset from the sides of the sidebar. Clicking a seat starts a fresh chat for that seat. The agent menu is not opened, and nothing watches the whole page.
 * - New thread, including the phone plus, opens a fresh chat for the seat already on screen.
 * - On a phone the sidebar fills the screen. Five controls share the full width: three chosen icons, a chevron that pops a menu you can drag, and new thread. The footer icon row stays hidden. The menu is two-thirds of the bar, starting a tenth of the way in. Its title is the workspace, with settings on the right, in a slightly smaller font. It lists the other sections, the file browser, and the bug report. A row darkens while it is pressed, and so does a bar icon. Picking a seat closes the menu. The open seat stays in view. The swipe tracks the full width of the screen, and the bar leaves as soon as the drawer closes. The fold control is large enough to hit. The open section is marked. Escape closes the menu. Customise picks the three. Row text is larger.
 */
const rememberedKey = "boltrig.seatThreads";
const pendingKey = "boltrig.seatPending";
const leftKey = "boltrig.seatLeft";
const activeKey = "boltrig.activeSeat";
const folderKey = "boltrig.activeFolder";
const tierKey = "boltrig.activeTier";
const closedKey = "boltrig.seatClosed";
function nodeKey(node: Node): string {
  return node.folder?.path ?? node.seat.id;
}

function rowName(node: Node): string {
  return node.folder?.name ?? folderName(node.seat.id);
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
    const key = `bb.promptbox.session-options-${encodeURIComponent("acp-opencode")}-1`;
    const current = storage.getItem(key);
    const updated = next(current);
    if (updated !== current) storage.setItem(key, updated);
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
[data-seat-vision-warning] {
  margin: 8px 12px 0;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 16px;
  color: var(--destructive);
  background: color-mix(in oklab, var(--destructive) 10%, transparent);
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-editor-scroll] {
  display: flex !important;
  align-items: center !important;
  min-height: 40px !important;
  max-height: calc(1.7em * 17 + 20px) !important;
  height: auto !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 45px !important;
  padding-right: 45px !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]):not(:has(.ProseMirror p.is-editor-empty)) [data-promptbox-editor-scroll],
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]):has([aria-label="Stop run"]) [data-promptbox-editor-scroll] {
  padding-right: 68px !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-editor-content] .ProseMirror {
  min-height: 0 !important;
  height: auto !important;
}
[data-promptbox]:not([data-promptbox-compact]) .ProseMirror p.is-editor-empty:first-child::before {
  content: "Type / for a command" !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Prompt actions"] {
  position: absolute !important;
  left: 19px !important;
  bottom: calc(100% + 11px) !important;
  top: auto !important;
  z-index: 3;
  width: 20px !important;
  height: 20px !important;
  min-width: 0 !important;
  padding: 0 !important;
  color: #191919 !important;
}
[data-promptbox]:not([data-promptbox-compact]) button[aria-label="Prompt actions"] svg {
  color: #191919 !important;
  opacity: 0 !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Prompt actions"] {
  background-color: transparent !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M7 1.5v11M1.5 7h11' stroke='%23191919' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 14px 14px !important;
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
  position: absolute !important;
  width: 0 !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
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
[data-testid="sidebar-update-button"],
[data-sidebar="panel"] li:has([data-testid="sidebar-update-button"]) {
  display: none !important;
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
  [data-sidebar="panel"] nav[aria-label="Seats"] button[aria-expanded],
  [data-sidebar="panel"] nav[aria-label="Seats"] [data-fold-space] {
    width: 32px !important;
    height: 32px !important;
  }
  [data-sidebar="panel"] nav[aria-label="Seats"] [data-seat-row] {
    scroll-margin-bottom: calc(80px + env(safe-area-inset-bottom));
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
    nav[aria-label="Seats"] [data-fold-mark] {
      transition: none;
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
[data-new-thread-footer] > div:first-child,
[data-follow-up-composer-footer] > div:first-child {
  display: none !important;
}
[data-new-thread-footer],
[data-follow-up-composer-footer] {
  justify-content: flex-end !important;
  margin-top: 0 !important;
  transition: none !important;
}
[data-promptbox-shell]:has([data-new-thread-footer]),
[data-follow-up-composer] {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-input-region] {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--background);
  box-shadow: 0 2px 10px color-mix(in oklab, black 6%, transparent);
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row] {
  position: relative !important;
  display: flex !important;
  justify-content: flex-end !important;
  align-items: center !important;
  height: 28px !important;
  min-height: 28px !important;
  padding: 0 !important;
  overflow: visible !important;
  flex-wrap: nowrap !important;
  gap: 0 !important;
}
[data-promptbox-shell]:has(> [data-new-thread-footer]) [data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row],
[data-follow-up-composer]:has(> [data-follow-up-composer-footer]) [data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row] {
  margin-top: 6px !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-standard-actions] {
  position: static !important;
  transform: none !important;
  translate: none !important;
  will-change: auto !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row] > [data-promptbox-standard-actions]:has(button[aria-label^="Provider, model"]) {
  flex: none !important;
  width: auto !important;
  min-width: 0 !important;
  margin-left: auto !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row] > [data-promptbox-standard-actions]:has(button[aria-label="Start voice input"]) {
  flex: none !important;
  width: 0 !important;
  min-width: 0 !important;
  overflow: visible !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-action-row] [data-promptbox-standard-actions] > span {
  position: static !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Start voice input"] {
  position: absolute !important;
  right: 14px !important;
  bottom: calc(100% + 11px) !important;
  top: auto !important;
  z-index: 4;
  width: 20px !important;
  height: 20px !important;
  min-width: 20px !important;
  min-height: 20px !important;
  margin: 0 !important;
  padding: 0 !important;
  color: #191919 !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Start voice input"] svg {
  color: #191919 !important;
}
[data-promptbox-shell]:has(> [data-new-thread-footer]) [data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Prompt actions"],
[data-promptbox-shell]:has(> [data-new-thread-footer]) [data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) button[aria-label="Start voice input"],
[data-promptbox-shell]:has(> [data-new-thread-footer]) [data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-submit-group] {
  bottom: calc(100% + 17px) !important;
}
[data-promptbox]:not([data-promptbox-compact]):not([data-promptbox-voice-active]) [data-promptbox-submit-group] {
  position: absolute !important;
  right: 42px !important;
  bottom: calc(100% + 11px) !important;
  top: auto !important;
  z-index: 3;
  margin: 0 !important;
}
[data-promptbox]:not([data-promptbox-compact]):has(.ProseMirror p.is-editor-empty) [data-promptbox-submit-group]:not(:has([aria-label="Stop run"])):not(:has([aria-label="Start voice input"])) {
  display: none !important;
}
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-send-menu] {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  color: #191919 !important;
  opacity: 1 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-send-menu] button[aria-label="Send options"] {
  display: none !important;
}
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-submit-group] button[type="submit"] {
  width: 20px !important;
  height: 20px !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: transparent !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M13.3 2.7v4.6a2.7 2.7 0 0 1-2.7 2.7H2.7M6 6.7 2.7 10 6 13.3' stroke='%23191919' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 16px 16px !important;
  color: #191919 !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  opacity: 1 !important;
}
[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-submit-group] button[type="submit"] svg {
  opacity: 0 !important;
}
[data-promptbox][data-promptbox-voice-active]:not([data-promptbox-compact]) [data-promptbox-action-row] {
  position: relative !important;
  display: flex !important;
  flex-wrap: nowrap !important;
  justify-content: flex-end !important;
  align-items: center !important;
  height: 28px !important;
  min-height: 28px !important;
  padding: 0 !important;
  overflow: visible !important;
  gap: 8px !important;
}
[data-promptbox-voice-active]:not([data-promptbox-compact]) [data-promptbox-editor-scroll] {
  min-height: 40px !important;
  visibility: hidden !important;
}
[data-promptbox-voice-active] button[aria-label="Prompt actions"],
[data-promptbox-voice-active] button[aria-label="Start voice input"] {
  display: none !important;
}
[data-promptbox-voice-active] [data-promptbox-standard-actions] {
  opacity: 1 !important;
  transform: none !important;
  translate: none !important;
}
[data-promptbox-voice-active] [data-promptbox-voice-controls] {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 100% !important;
  top: auto !important;
  z-index: 2 !important;
  display: block !important;
  width: auto !important;
  height: 42px !important;
  margin: 0 !important;
  padding: 0 !important;
  opacity: 1 !important;
  transform: none !important;
  translate: none !important;
  pointer-events: none !important;
  background: transparent !important;
}
[data-promptbox-voice-active] [data-promptbox-voice-controls] > div {
  position: static !important;
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  pointer-events: none !important;
}
[data-promptbox-voice-active] [data-voice-waveform],
[data-promptbox-voice-active] [data-promptbox-voice-controls] div:has(> div > canvas) {
  position: absolute !important;
  left: 11px !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  width: 4.5rem !important;
  min-width: 4.5rem !important;
  max-width: 4.5rem !important;
  height: 1.25rem !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  color: var(--foreground) !important;
  pointer-events: none !important;
}
[data-promptbox-voice-active] [data-voice-waveform] > div,
[data-promptbox-voice-active] [data-promptbox-voice-controls] div:has(> div > canvas) > div,
[data-promptbox-voice-active] [data-promptbox-voice-controls] canvas {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
}
[data-promptbox-voice-active] [data-promptbox-voice-controls] button {
  display: none !important;
}
[data-promptbox-voice-active] [data-voice-stop],
[data-promptbox-voice-active] [data-promptbox-voice-controls] button[aria-label="Stop and add to draft"],
[data-promptbox-voice-active] [data-promptbox-voice-controls] button[aria-label="Transcribing voice input"] {
  display: inline-flex !important;
  position: absolute !important;
  right: 11px !important;
  top: 50% !important;
  left: auto !important;
  bottom: auto !important;
  transform: translateY(-50%) !important;
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  min-height: 22px !important;
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 9999px !important;
  border: 1.5px solid var(--destructive) !important;
  background: transparent !important;
  color: transparent !important;
  box-shadow: none !important;
  pointer-events: auto !important;
  z-index: 3 !important;
}
[data-promptbox-voice-active] [data-promptbox-voice-controls] button svg {
  display: none !important;
}
[data-promptbox-shell]:has(> [data-new-thread-footer]),
[data-follow-up-composer] {
  position: relative;
}
[data-new-thread-footer],
[data-follow-up-composer-footer] {
  position: absolute !important;
  right: 4px !important;
  bottom: 0 !important;
  left: auto !important;
  width: auto !important;
  height: 28px !important;
  min-height: 28px !important;
  max-height: 28px !important;
  margin: 0 !important;
  display: flex !important;
  align-items: center !important;
  background: transparent !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"],
[data-new-thread-footer] button[aria-label="Permission mode"],
[data-follow-up-composer-footer] button[aria-label="Permission mode"],
[data-follow-up-composer-footer] button[aria-label^="Context window"] {
  display: inline-flex !important;
  align-items: center !important;
  height: 22px !important;
  min-height: 0 !important;
  padding: 0 !important;
  font-size: 11px !important;
  line-height: 22px !important;
  font-weight: 400 !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"],
[data-new-thread-footer],
[data-follow-up-composer-footer],
[data-seat-context] {
  visibility: hidden !important;
}
html[data-composer-meta="ready"] [data-promptbox-action-row] button[aria-label^="Provider, model"],
html[data-composer-meta="ready"] [data-new-thread-footer],
html[data-composer-meta="ready"] [data-follow-up-composer-footer],
html[data-composer-meta="ready"] [data-seat-context] {
  visibility: visible !important;
}
.pb-4:has([data-promptbox-shell]),
[data-testid="root-compose-compact-composer"] > .bg-background {
  padding-bottom: 6px !important;
}
[data-new-thread-footer] button[aria-label="Permission mode"],
[data-follow-up-composer-footer] button[aria-label="Permission mode"] {
  color: #191919 !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] {
  gap: 10px !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] span.truncate {
  color: #191919 !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] [data-promptbox-hide-compact] {
  color: #8c8c8c !important;
  font-weight: 400 !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > svg,
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > img,
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > [data-icon],
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > [data-icon-root],
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > [data-provider-logo],
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > :has(svg),
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > :has([data-icon-root]),
[data-promptbox-action-row] button[aria-label^="Provider, model"] > span > :has([data-provider-logo]) {
  display: none !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] svg,
[data-new-thread-footer] button[aria-label="Permission mode"] svg,
[data-follow-up-composer-footer] button[aria-label="Permission mode"] svg,
[data-follow-up-composer-footer] button[aria-label^="Context window"] svg {
  width: 14px !important;
  height: 14px !important;
}
[data-promptbox-action-row] button[aria-label^="Provider, model"] [data-icon="ChevronDown"],
[data-new-thread-footer] button[aria-label="Permission mode"] [data-icon="ChevronDown"],
[data-follow-up-composer-footer] button[aria-label="Permission mode"] [data-icon="ChevronDown"] {
  display: none !important;
}
button[data-permission-alias="auto"] [data-promptbox-compact-label] {
  display: none !important;
}
button[data-permission-alias="auto"] [data-promptbox-full-label],
button[data-permission-alias="auto"] > span > span.truncate:not([data-promptbox-compact-label]) {
  display: inline-flex !important;
  align-items: center !important;
  height: 22px !important;
  font-size: 0 !important;
  line-height: 0 !important;
  color: transparent !important;
}
button[data-permission-alias="auto"] [data-promptbox-full-label]::after,
button[data-permission-alias="auto"] > span > span.truncate:not([data-promptbox-compact-label]):not([data-promptbox-full-label])::after {
  content: "Auto";
  font-size: 11px;
  line-height: 22px;
  font-weight: 400;
  color: #191919;
}
[data-testid="thread-secondary-panel-top-chrome"] {
  position: relative !important;
  z-index: 30 !important;
  align-items: stretch !important;
  padding-left: 0 !important;
  background: color-mix(in oklab, var(--foreground) 4%, var(--background)) !important;
  box-shadow: inset 0 -1px 0 var(--border) !important;
}
[data-testid="thread-secondary-panel-top-chrome"] > div {
  align-items: stretch !important;
}
[role="toolbar"][aria-label="Right panel views"] {
  gap: 0 !important;
  align-items: stretch !important;
}
[role="toolbar"][aria-label="Right panel views"] [data-testid="secondary-panel-tab-strip"] {
  flex: 0 1 auto !important;
  align-self: stretch !important;
  min-width: 0 !important;
  max-width: 100% !important;
  height: auto !important;
  background: transparent !important;
}
[role="toolbar"][aria-label="Right panel views"] > button {
  align-self: center !important;
  margin-left: 6px !important;
}
aside:has([data-testid='thread-secondary-panel-top-chrome']) {
  --seat-tab-bar: color-mix(in oklab, var(--background) 95%, var(--foreground));
  --seat-tab-line: color-mix(in oklab, var(--foreground) 10%, var(--background));
  --seat-tab-active: var(--background);
  --seat-tab-hover: color-mix(in oklab, var(--background) 70%, var(--seat-tab-bar));
}
[data-testid='thread-secondary-panel-top-chrome'] {
  height: 35px !important;
  min-height: 35px !important;
  max-height: 35px !important;
  background: var(--seat-tab-bar) !important;
  align-items: stretch !important;
}
[data-testid='thread-secondary-panel-top-chrome'] > [data-sidebar-split-tab-group] {
  height: 35px !important;
  align-items: stretch !important;
}
[data-testid='secondary-panel-tab-strip'] {
  height: 35px !important;
  align-items: stretch !important;
  gap: 0 !important;
}
[data-secondary-panel-tab-scroll-region],
[data-secondary-panel-tab-scroll-region] > div:has([data-secondary-panel-tab-content]) {
  flex: 0 1 auto !important;
  height: 35px !important;
  min-width: 0 !important;
  max-width: 100% !important;
  background: transparent !important;
}
[data-secondary-panel-tab-content] {
  width: max-content !important;
  max-width: none !important;
  height: 35px !important;
  gap: 0 !important;
  align-items: stretch !important;
  background: transparent !important;
}
[data-secondary-panel-tab-content] > div[id^="DndDescribedBy"],
[data-secondary-panel-tab-content] > div[id^="DndLiveRegion"] {
  display: none !important;
}
[data-secondary-panel-tab-content] > :not([id^="Dnd"]) {
  flex: 0 0 auto !important;
  display: flex !important;
  height: 35px !important;
  width: fit-content !important;
  min-width: 90px !important;
  max-width: 180px !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] {
  position: relative !important;
  flex: 1 1 auto !important;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  box-sizing: border-box !important;
  width: 100% !important;
  height: 35px !important;
  padding: 0 10px 0 12px !important;
  border-radius: 0 !important;
  border-right: 1px solid var(--seat-tab-line) !important;
  background: var(--seat-tab-bar) !important;
  color: var(--muted-foreground) !important;
  box-shadow: none !important;
}
[data-secondary-panel-tab-content] [data-tab-pill]:hover {
  background: var(--seat-tab-hover) !important;
}
[data-secondary-panel-tab-content] [data-tab-pill]:has(> button[aria-pressed="true"]) {
  background: var(--seat-tab-active) !important;
  color: var(--foreground) !important;
  box-shadow: inset 0 1px 0 var(--foreground) !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] > button:not([data-tab-pill-close]):not([aria-label^="Close "]) {
  flex: 1 1 auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  gap: 8px !important;
  min-width: 0 !important;
  height: 100% !important;
  padding: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: inherit !important;
  box-shadow: none !important;
  font-size: 13px !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] > button > span {
  opacity: 1 !important;
  margin-right: 0 !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] > button > span:first-child {
  width: 14px !important;
  height: 14px !important;
  flex: none !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] > button > span:first-child svg {
  width: 14px !important;
  height: 14px !important;
}
[data-secondary-panel-tab-content] [data-tab-pill] .truncate {
  max-width: none !important;
  text-align: left !important;
  font-size: 13px !important;
  line-height: 1 !important;
}
[data-tab-pill-close],
[data-secondary-panel-tab-content] button[aria-label^="Close "] {
  position: static !important;
  flex: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 16px !important;
  height: 16px !important;
  margin: 0 0 0 1px !important;
  padding: 0 !important;
  border-radius: 3px !important;
  opacity: 0 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  transform: none !important;
  translate: none !important;
  color: inherit !important;
  inset: auto !important;
}
[data-tab-pill-close] svg,
[data-secondary-panel-tab-content] button[aria-label^="Close "] svg {
  width: 12px !important;
  height: 12px !important;
}
[data-secondary-panel-tab-content] [data-tab-pill]:hover [data-tab-pill-close],
[data-secondary-panel-tab-content] [data-tab-pill]:has(> button[aria-pressed="true"]) [data-tab-pill-close],
[data-secondary-panel-tab-content] [data-tab-pill]:hover button[aria-label^="Close "],
[data-secondary-panel-tab-content] [data-tab-pill]:has(> button[aria-pressed="true"]) button[aria-label^="Close "] {
  opacity: 0.8 !important;
}
[data-tab-pill-close]:hover,
[data-secondary-panel-tab-content] button[aria-label^="Close "]:hover {
  opacity: 1 !important;
  background: color-mix(in oklab, var(--foreground) 10%, transparent) !important;
}
[data-testid='thread-secondary-panel-top-chrome'] button[aria-label^="Open new tab"] {
  width: 35px !important;
  min-width: 35px !important;
  height: 35px !important;
  min-height: 35px !important;
  border-radius: 0 !important;
  align-self: center !important;
}
[data-testid='thread-info-tab'],
[data-testid='thread-info-tab'] [data-tab-pill] {
  height: 35px !important;
}
html[data-seat-term-light="true"] .xterm,
html[data-seat-term-light="true"] .xterm .xterm-viewport,
html[data-seat-term-light="true"] .xterm .xterm-screen {
  background-color: #ffffff !important;
}
[data-new-thread-footer] button[aria-label^="Context window"],
[data-follow-up-composer-footer] button[aria-label^="Context window"] {
  display: none !important;
}
[data-promptbox] button[aria-label="Collapse prompt box"],
[data-promptbox] [data-promptbox-standard-actions]:has(> button[aria-label="Collapse prompt box"]) {
  display: none !important;
}
div.max-w-full.rounded-xl.border-border-seam.bg-surface-recessed {
  border: 0 !important;
  box-shadow: none !important;
  outline: 0 !important;
}
aside[data-pane-view="terminal"] [data-pane-kind="info"],
aside[data-pane-view="info"] [data-pane-kind="tabs"] {
  display: none !important;
}
aside[data-pane-view="terminal"] [data-pane-kind="tabs"],
aside[data-pane-view="info"] [data-pane-kind="info"] {
  left: 0 !important;
  width: 100% !important;
}
aside[data-pane-fit="split"] [data-pane-kind="info"] {
  left: 0 !important;
  width: 340px !important;
}
aside[data-pane-fit="split"] [data-pane-kind="tabs"] {
  left: 340px !important;
  width: calc(100% - 340px) !important;
}
aside[data-pane-fit="split"] [role="separator"],
aside[data-pane-view="terminal"] [role="separator"],
aside[data-pane-view="info"] [role="separator"] {
  display: none !important;
}
svg[data-icon="Terminal"] {
  background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M5 7.5l4.5 4.5L5 16.5M12.5 17h6.5' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M5 7.5l4.5 4.5L5 16.5M12.5 17h6.5' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
svg[data-icon="Terminal"] > * {
  display: none;
}
[data-seat-context] {
  position: fixed;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #191919;
  cursor: pointer;
  z-index: 20;
  pointer-events: auto;
}
[data-seat-context-card] {
  position: fixed;
  z-index: 40;
  width: 340px;
  box-sizing: border-box;
  padding: 12px 14px 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--background);
  color: var(--foreground);
  box-shadow: 0 10px 28px rgb(0 0 0 / 12%);
  font-size: 12px;
  line-height: 1.35;
}
[data-seat-context-card][hidden] {
  display: none !important;
}
[data-seat-context-head] {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
[data-seat-context-title] {
  font-size: 13px;
  font-weight: 600;
}
[data-seat-context-report] {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  cursor: pointer;
}
[data-seat-context-report]:hover {
  color: var(--foreground);
}
[data-seat-context-summary] {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
[data-seat-context-percent] {
  font-weight: 500;
}
[data-seat-context-tokens] {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
[data-seat-context-bar] {
  display: flex;
  height: 6px;
  overflow: hidden;
  margin-bottom: 8px;
  border-radius: 999px;
  background: var(--border);
}
[data-seat-context-bar] > span {
  height: 100%;
}
[data-seat-context-rows] {
  display: flex;
  flex-direction: column;
}
[data-seat-context-row] {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
[data-seat-context-swatch] {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 2px;
}
[data-seat-context-label] {
  min-width: 0;
  flex: 1;
}
[data-seat-context-count] {
  flex: none;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
[data-seat-usage] {
  margin: -4px -4px 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
[data-seat-usage-head],
[data-seat-usage-meta] {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
[data-seat-usage-head] {
  margin-bottom: 8px;
}
[data-seat-usage-head] > span,
[data-seat-usage-meta] > span:first-child {
  min-width: 0;
  flex: 1;
}
[data-seat-usage-all] {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  cursor: pointer;
}
[data-seat-usage-meta] {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
[data-seat-usage-meta] > span:first-child {
  color: var(--foreground);
}
[data-seat-usage-track] {
  height: 3px;
  margin: 6px 0 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border);
}
[data-seat-usage-track] > span {
  display: block;
  height: 100%;
}
[data-seat-picker]:not([data-seat-picker-placed]) {
  visibility: hidden;
  pointer-events: none;
}
[data-seat-picker] {
  position: fixed;
  z-index: 25;
  width: 260px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--background);
  color: var(--foreground);
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
  padding: 4px;
  font-size: 13px;
}
[data-seat-picker] button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-seat-picker] button:hover {
  background: var(--muted);
}
[data-seat-picker] [data-seat-picker-check] {
  margin-left: auto;
}
[data-seat-picker] [data-seat-picker-rule] {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
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
    if (!label || phoneSkip.has(label) || seen.has(label) || /update available$/i.test(label) || label === "Updating") continue;
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
  const found = document.querySelector("[data-seat-composer-bar]");
  let style: HTMLStyleElement;
  if (found instanceof HTMLStyleElement) style = found;
  else {
    style = document.createElement("style");
    style.dataset.seatComposerBar = "true";
    document.head.appendChild(style);
  }
  if (style.textContent !== COMPOSER_BAR_STYLE) style.textContent = COMPOSER_BAR_STYLE;
}

const paneInfoIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="currentColor" data-icon="Info" data-icon-root="" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" stroke-width="1.5"></rect><path d="M8 8.5h.01M8 12h.01M8 15.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><path d="M11.5 8.5H16M11.5 12H16M11.5 15.5H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`;

function paintPaneInfoIcon() {
  for (const rail of document.querySelectorAll('button[aria-label="Show thread info panel"] svg[data-icon="Info"]')) {
    if (rail instanceof SVGElement && rail.querySelector("circle")) rail.outerHTML = paneInfoIcon;
  }
  const button = document.querySelector(
    '[data-thread-header-pane-actions] > button[aria-label^="Show right panel"], [data-thread-header-pane-actions] > button[aria-label^="Hide right panel"]',
  );
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.remove("hidden");
  if (button.hasAttribute("inert")) button.removeAttribute("inert");
  const icon = button.querySelector("svg");
  if (icon instanceof SVGElement && (icon.dataset.icon !== "Info" || icon.querySelector("circle"))) icon.outerHTML = paneInfoIcon;
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

function aliasPermissionLabel() {
  document.querySelectorAll('button[aria-label="Permission mode"]').forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    const full = button.querySelector("[data-promptbox-full-label]");
    const plain = button.querySelector(":scope > span > span.truncate");
    const text = (full ?? plain)?.textContent?.trim() ?? "";
    const alias = text === "Full Access" || text === "Full";
    if (alias && button.dataset.permissionAlias !== "auto") button.dataset.permissionAlias = "auto";
    if (!alias && button.dataset.permissionAlias === "auto") delete button.dataset.permissionAlias;
  });
}

const contextPalette = ["#6b7280", "#a855f7", "#22c55e", "#d97706", "#ec4899", "#3b82f6", "#ef4444", "#f97316"];
const contextColors: Record<string, string> = {
  "system prompt": "#6b7280",
  "tool definitions": "#a855f7",
  rules: "#22c55e",
  skills: "#d97706",
  "mcp & dynamic tools": "#ec4899",
  "subagent definitions": "#3b82f6",
  "summarized conversation": "#ef4444",
  conversation: "#f97316",
};
const emptyContextRows = [
  "System prompt",
  "Tool definitions",
  "Rules",
  "Skills",
  "MCP & dynamic tools",
  "Subagent definitions",
  "Summarized conversation",
  "Conversation",
].map((label) => ({ label, tokens: 0, color: contextColors[label.toLowerCase()] ?? "#6b7280" }));

interface ContextRow {
  label: string;
  tokens: number;
  color: string;
}

interface ContextView {
  threadId: string;
  used: number;
  capacity: number;
  estimated: boolean;
  rows: ContextRow[];
  rowsEstimated?: boolean;
  fetchedAt: number;
}

let contextView: ContextView = { threadId: "", used: 0, capacity: 0, estimated: false, rows: emptyContextRows, fetchedAt: 0 };
let contextRequest = 0;
let contextBound = false;

interface UsageWindowView {
  plan: string;
  label: string;
  resets: string;
  percent: number;
}

let usageWindows: UsageWindowView[] = [];

function usageRowLabel(label: string): string {
  const text = label.replace(" · ", " - ");
  if (/ - /.test(text) || /all models/i.test(text)) return text;
  if (/^weekly/i.test(text)) return "Weekly - all models";
  return text;
}

function formatResetAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Resets at ${time}`;
  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  return `Resets ${day} ${time}`;
}

function contextThreadId(): string {
  return window.location.pathname.match(/\/threads\/([^/]+)/)?.[1] ?? "";
}

function formatContextTokens(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000;
    const text = thousands >= 100 ? String(Math.round(thousands)) : thousands.toFixed(1).replace(/\.0$/, "");
    return `${text}K`;
  }
  return String(Math.round(value));
}

function contextPercent(view: ContextView): number {
  if (view.capacity <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((view.used / view.capacity) * 100)));
}

function contextRingSvg(percent: number): string {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  const arc = percent > 0
    ? `<circle cx="8" cy="8" r="${radius}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"></circle>`
    : "";
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="${radius}" fill="none" stroke="currentColor" stroke-width="1.75" opacity="0.45"></circle>${arc}</svg>`;
}

function escapeContextText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}

function contextRowsFromUsage(usage: { usedTokens?: number | null; snapshot?: { categories?: { label: string; kind: string; tokens: number }[] } } | null): ContextRow[] {
  const categories = usage?.snapshot?.categories?.filter((category) => category.kind === "used") ?? [];
  if (categories.length > 0) {
    return categories.map((category, index) => {
      const label = category.label.replace(/\s*\(deferred\)$/i, "");
      return {
        label,
        tokens: category.tokens,
        color: contextColors[label.toLowerCase()] ?? contextPalette[index % contextPalette.length] ?? "#6b7280",
      };
    });
  }
  const used = usage?.usedTokens ?? 0;
  return emptyContextRows.map((row) => row.label === "Conversation" && used > 0 ? { ...row, tokens: used } : { ...row });
}

async function loadEstimatedRows(threadId: string, used: number, capacity: number): Promise<ContextRow[] | null> {
  try {
    const threadResponse = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`, { credentials: "same-origin" });
    if (!threadResponse.ok) return null;
    const thread = await threadResponse.json() as { environmentId?: string | null };
    let cwd: string | null = null;
    if (thread.environmentId) {
      const environmentResponse = await fetch(`/api/v1/environments/${encodeURIComponent(thread.environmentId)}`, { credentials: "same-origin" });
      if (environmentResponse.ok) cwd = ((await environmentResponse.json()) as { path?: string | null }).path ?? null;
    }
    const response = await fetch("/api/v1/plugins/boltrig-agent-editor/rpc/estimateContext", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cwd, usedTokens: used, windowTokens: capacity }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { ok?: boolean; result?: { categories: { label: string; kind: string; tokens: number }[] } };
    if (body.ok !== true || !body.result) return null;
    return contextRowsFromUsage({ usedTokens: used, snapshot: { categories: body.result.categories } });
  } catch {
    return null;
  }
}

function refreshContext(force = false) {
  const threadId = contextThreadId();
  const now = Date.now();
  if (!force && threadId === contextView.threadId && now - contextView.fetchedAt < 5000) return;
  if (threadId === "") {
    contextView = { threadId: "", used: 0, capacity: 0, estimated: false, rows: emptyContextRows.map((row) => ({ ...row })), fetchedAt: now };
    renderContextCard();
    return;
  }
  const request = ++contextRequest;
  contextView = { ...contextView, threadId, fetchedAt: now };
  void fetch(`/api/v1/threads/${encodeURIComponent(threadId)}/context`, { credentials: "same-origin" })
    .then((response) => response.ok ? response.json() as Promise<{ usage?: { usedTokens?: number | null; modelContextWindow?: number | null; estimated?: boolean; snapshot?: { categories?: { label: string; kind: string; tokens: number }[] } } | null }> : { usage: null })
    .then((body) => {
      if (request !== contextRequest) return;
      const usage = body.usage ?? null;
      const keepEstimate = contextView.rowsEstimated === true && contextView.threadId === threadId && (usage?.snapshot?.categories?.length ?? 0) === 0;
      contextView = {
        threadId,
        used: usage?.usedTokens ?? 0,
        capacity: usage?.modelContextWindow ?? 0,
        estimated: usage?.estimated === true,
        rows: keepEstimate ? contextView.rows : contextRowsFromUsage(usage),
        ...(keepEstimate ? { rowsEstimated: true } : {}),
        fetchedAt: Date.now(),
      };
      renderContextCard();
      if ((usage?.snapshot?.categories?.length ?? 0) === 0 && (usage?.usedTokens ?? 0) > 0 && (usage?.modelContextWindow ?? 0) > 0) {
        void loadEstimatedRows(threadId, usage?.usedTokens ?? 0, usage?.modelContextWindow ?? 0).then((rows) => {
          if (request !== contextRequest || rows === null) return;
          contextView = { ...contextView, rows, rowsEstimated: true };
          renderContextCard();
        });
      }
      document.querySelectorAll<HTMLElement>("[data-seat-context]").forEach((ring) => {
        const percent = String(contextPercent(contextView));
        if (ring.dataset.percent !== percent) {
          ring.dataset.percent = percent;
          ring.innerHTML = contextRingSvg(contextPercent(contextView));
          ring.setAttribute("aria-label", `Context window ${percent}% used`);
        }
      });
    })
    .catch(() => {
      if (request !== contextRequest) return;
      contextView = { ...contextView, used: 0, capacity: 0, rows: emptyContextRows.map((row) => ({ ...row })) };
      renderContextCard();
    });
}

function usageLimitsHtml(expanded: boolean): string {
  if (usageWindows.length === 0) return "";
  const ordered = [...usageWindows].sort((left, right) => right.percent - left.percent);
  const shown = expanded ? ordered : ordered.slice(0, 1);
  const plan = ordered[0]?.plan ?? "Plan";
  const rows = shown.map((window) => {
    const width = Math.max(0, Math.min(window.percent, 100));
    const color = window.percent >= 90 ? "var(--destructive)" : "var(--foreground)";
    return `<div data-seat-usage-row><div data-seat-usage-meta><span>${escapeContextText(window.label)}</span><span>${escapeContextText(window.resets)}</span><span>${window.percent}%</span></div><div data-seat-usage-track><span style="width:${width}%;background:${color}"></span></div></div>`;
  }).join("");
  return `<div data-seat-usage><div data-seat-usage-head><span>Plan usage limits - ${escapeContextText(plan)}</span><button type="button" data-seat-usage-all>See all</button></div>${rows}</div>`;
}

async function refreshUsageLimits() {
  const read = async (providerIds: string[]) => {
    const response = await fetch("/api/v1/plugins/bb--provider-usage/rpc/getUsage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ force: false, machineIds: null, providerIds, maxAgeMs: 120000 }),
    });
    if (!response.ok) return null;
    const body = await response.json() as {
      ok?: boolean;
      result?: {
        machines?: {
          providers?: {
            providerId?: string;
            usage?: { status?: string; planLabel?: string | null; windows?: { label: string; usedPercent: number; resetsAt: string | null }[] } | null;
          }[];
        }[];
      };
    };
    return body.ok === true ? body.result ?? null : null;
  };
  try {
    const listed = await read([]);
    const ids = [...new Set((listed?.machines ?? []).flatMap((machine) => (
      (machine.providers ?? []).map((provider) => provider.providerId).filter((id): id is string => typeof id === "string" && id.length > 0)
    )))];
    const snapshot = ids.length > 0 ? await read(ids) : listed;
    const windows: UsageWindowView[] = [];
    for (const machine of snapshot?.machines ?? []) {
      for (const provider of machine.providers ?? []) {
        if (provider.usage?.status !== "ok") continue;
        const plan = provider.usage.planLabel || "Plan";
        for (const window of provider.usage.windows ?? []) {
          windows.push({
            plan,
            label: usageRowLabel(window.label),
            resets: formatResetAt(window.resetsAt),
            percent: Math.max(0, Math.round(window.usedPercent)),
          });
        }
      }
    }
    if (windows.length > 0) {
      usageWindows = windows;
      renderContextCard();
    }
  } catch {
    return;
  }
}

let lastCardHtml = "";

function renderContextCard() {
  const card = document.querySelector("[data-seat-context-card]");
  if (!(card instanceof HTMLElement) || card.hidden) return;
  const percent = contextPercent(contextView);
  const capacity = contextView.capacity;
  const tokenText = capacity > 0
    ? `${contextView.estimated ? "~" : ""}${formatContextTokens(contextView.used)} / ${formatContextTokens(capacity)} Tokens`
    : "0 Tokens";
  const segments = contextView.rows.filter((row) => row.tokens > 0 && capacity > 0);
  const bar = segments.length > 0
    ? segments.map((row) => `<span style="width:${(row.tokens / capacity) * 100}%;background:${row.color}"></span>`).join("")
    : percent > 0 ? `<span style="width:${percent}%;background:#f97316"></span>` : "";
  const rows = contextView.rows.map((row) => (
    `<div data-seat-context-row><span data-seat-context-swatch style="background:${row.color}"></span><span data-seat-context-label>${escapeContextText(row.label)}</span><span data-seat-context-count>${contextView.rowsEstimated === true ? "~" : ""}${formatContextTokens(row.tokens)}</span></div>`
  )).join("");
  const limits = usageLimitsHtml(card.dataset.usageExpanded === "true");
  const html = `${limits}<div data-seat-context-head><span data-seat-context-title>Context Usage</span><button type="button" data-seat-context-report>View Report</button></div><div data-seat-context-summary><span data-seat-context-percent>${percent}% Full</span><span data-seat-context-tokens>${tokenText}</span></div><div data-seat-context-bar>${bar}</div><div data-seat-context-rows>${rows}</div>`;
  if (lastCardHtml === html) return;
  lastCardHtml = html;
  card.innerHTML = html;
  const anchor = document.querySelector(`[data-seat-context="${card.dataset.anchor ?? ""}"]`);
  if (anchor instanceof HTMLElement) placeContextCard(anchor);
}

function placeContextCard(ring: HTMLElement) {
  const card = document.querySelector("[data-seat-context-card]");
  if (!(card instanceof HTMLElement) || card.hidden) return;
  const rect = ring.getBoundingClientRect();
  const width = card.offsetWidth || 340;
  const height = card.offsetHeight || 260;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  let top = rect.top - height - 10;
  if (top < 8) top = rect.bottom + 10;
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function ensureContextCard(): HTMLElement {
  const existing = document.querySelector("[data-seat-context-card]");
  if (existing instanceof HTMLElement) return existing;
  const card = document.createElement("div");
  card.dataset.seatContextCard = "true";
  card.hidden = true;
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-seat-usage-all]") !== null) {
      card.dataset.usageExpanded = card.dataset.usageExpanded === "true" ? "false" : "true";
      renderContextCard();
      return;
    }
    if (target.closest("[data-seat-context-report]") === null) return;
    showInfoPane();
  });
  document.body.appendChild(card);
  return card;
}

function toggleContextCard(ring: HTMLElement) {
  const card = ensureContextCard();
  const open = card.hidden || card.dataset.anchor !== ring.dataset.seatContext;
  card.dataset.anchor = ring.dataset.seatContext ?? "";
  card.hidden = !open;
  if (!open) return;
  refreshContext(true);
  void refreshUsageLimits();
  renderContextCard();
  placeContextCard(ring);
}

function bindContextCard() {
  if (contextBound) return;
  contextBound = true;
  document.addEventListener("click", (event) => {
    const card = document.querySelector("[data-seat-context-card]");
    if (!(card instanceof HTMLElement) || card.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (card.contains(target)) return;
    if (target instanceof Element && target.closest("[data-seat-context]") !== null) return;
    card.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const card = document.querySelector("[data-seat-context-card]");
    if (card instanceof HTMLElement) card.hidden = true;
  });
}

function paintContextRing() {
  bindContextCard();
  refreshContext();
  const footers = document.querySelectorAll("[data-new-thread-footer], [data-follow-up-composer-footer]");
  const used = new Set<Element>();
  const percent = contextPercent(contextView);
  footers.forEach((footer, index) => {
    if (!(footer instanceof HTMLElement)) return;
    const permission = footer.querySelector('button[aria-label="Permission mode"]');
    const existingRing = document.querySelector(`[data-seat-context="${index}"]`);
    let ring: HTMLButtonElement | null = existingRing instanceof HTMLButtonElement ? existingRing : null;
    const show = permission instanceof HTMLElement && footer.getClientRects().length > 0;
    if (!show) {
      footer.style.removeProperty("padding-right");
      if (existingRing !== null) existingRing.remove();
      return;
    }
    if (footer.style.getPropertyValue("padding-right") !== "32px") {
      footer.style.setProperty("padding-right", "32px", "important");
    }
    if (ring === null) {
      const created = document.createElement("button");
      created.type = "button";
      created.dataset.seatContext = String(index);
      created.dataset.percent = "";
      created.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleContextCard(created);
      });
      document.body.appendChild(created);
      ring = created;
    }
    const nextPercent = String(percent);
    if (ring.dataset.percent !== nextPercent) {
      ring.dataset.percent = nextPercent;
      ring.innerHTML = contextRingSvg(percent);
      ring.setAttribute("aria-label", `Context window ${nextPercent}% used`);
      ring.title = `Context window ${nextPercent}% used`;
    }
    const model = footer.parentElement?.querySelector('[data-promptbox]:not([data-promptbox-compact]) button[aria-label^="Provider, model"]');
    const anchor = model instanceof HTMLElement ? model : permission;
    const anchorRect = anchor.getBoundingClientRect();
    const permRect = permission.getBoundingClientRect();
    ring.style.left = `${Math.round(permRect.right + 10)}px`;
    ring.style.top = `${Math.round(anchorRect.top + anchorRect.height / 2 - 11)}px`;
    used.add(ring);
    const card = document.querySelector("[data-seat-context-card]");
    if (card instanceof HTMLElement && !card.hidden && card.dataset.anchor === String(index)) placeContextCard(ring);
  });
  document.querySelectorAll("[data-seat-context]").forEach((ring) => {
    if (!used.has(ring)) ring.remove();
  });
}

function alignComposerMeta() {
  document.querySelectorAll("[data-new-thread-footer], [data-follow-up-composer-footer]").forEach((footer) => {
    if (!(footer instanceof HTMLElement)) return;
    const row = footer.parentElement?.querySelector("[data-promptbox]:not([data-promptbox-compact]) [data-promptbox-action-row]");
    if (!(row instanceof HTMLElement)) return;
    const box = row.closest("[data-promptbox]");
    if (!(box instanceof HTMLElement)) return;
    const shell = footer.parentElement;
    if (shell instanceof HTMLElement) {
      const top = `${Math.round(row.getBoundingClientRect().top - shell.getBoundingClientRect().top)}px`;
      const height = `${Math.round(row.getBoundingClientRect().height)}px`;
      if (footer.style.getPropertyValue("top") !== top) footer.style.setProperty("top", top, "important");
      if (footer.style.getPropertyValue("height") !== height) footer.style.setProperty("height", height, "important");
      footer.style.setProperty("bottom", "auto", "important");
      footer.style.setProperty("translate", "none", "important");
    }
    const permission = footer.querySelector('button[aria-label="Permission mode"]');
    const context = footer.querySelector('button[aria-label^="Context window"]');
    const anchor = permission instanceof HTMLElement ? permission : context;
    let pad = 12;
    if (anchor instanceof HTMLElement) {
      pad = Math.max(12, Math.ceil(row.getBoundingClientRect().right - anchor.getBoundingClientRect().left) + 10);
    }
    const next = `${pad}px`;
    if (row.style.getPropertyValue("padding-right") !== next) {
      row.style.setProperty("padding-right", next, "important");
    }
    if (document.documentElement.dataset.composerMeta !== "ready") {
      document.documentElement.dataset.composerMeta = "ready";
    }
  });
}

function placeSeatPicker() {
  const picker = document.querySelector("[data-seat-picker]");
  if (!(picker instanceof HTMLElement)) return;
  const shell = document.querySelector("[data-new-thread-footer]")?.closest("[data-promptbox-shell]");
  if (!(shell instanceof HTMLElement)) return;
  const shellRect = shell.getBoundingClientRect();
  const top = 72;
  const mid = top + Math.max(24, shellRect.top - top) / 2;
  picker.style.left = `${Math.round(shellRect.left + shellRect.width / 2)}px`;
  picker.style.top = `${Math.round(mid)}px`;
  picker.dataset.seatPickerPlaced = "true";
}

let paneButtonsBound = false;
let paneButtonUntil = 0;
type PaneView = "both" | "info" | "terminal";
let paneView: PaneView = "both";
let lastTerminalIndex = 0;

function rightAside(): HTMLElement | null {
  const aside = document.querySelector("aside:has([data-testid='thread-secondary-panel-top-chrome'])");
  return aside instanceof HTMLElement ? aside : null;
}

let panelIntent: { open: boolean; until: number } | null = null;

function expectPanel(open: boolean) {
  panelIntent = { open, until: Date.now() + 900 };
}

function rightPanelOpen(): boolean {
  if (panelIntent !== null) {
    if (Date.now() < panelIntent.until) return panelIntent.open;
    panelIntent = null;
  }
  const aside = rightAside();
  if (aside === null) return false;
  return aside.getBoundingClientRect().left < window.innerWidth - 20;
}

function terminalPills(): { select: HTMLElement; selected: boolean }[] {
  const found: { select: HTMLElement; selected: boolean }[] = [];
  document.querySelectorAll("[data-tab-pill]").forEach((pill) => {
    if (pill.querySelector('svg[data-icon="Terminal"]') === null) return;
    const select = pill.querySelector(":scope > button:not([data-tab-pill-close]):not([aria-label^='Close '])");
    if (!(select instanceof HTMLElement)) return;
    found.push({ select, selected: select.getAttribute("aria-pressed") === "true" });
  });
  return found;
}

function toggleRightPanelKey() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true, bubbles: true, cancelable: true }));
}

function hideRightPanel() {
  const hide = rightAside()?.querySelector("button[aria-label^='Hide right panel']");
  expectPanel(false);
  if (hide instanceof HTMLElement) hide.click();
}

function newTabPill(): HTMLElement | null {
  for (const pill of document.querySelectorAll("[data-tab-pill]")) {
    if (pill instanceof HTMLElement && pill.querySelector('svg[data-icon="NewTab"]') !== null) return pill;
  }
  return null;
}

function settleTerminalAfterShow(hadNewTab: boolean, attempts: number) {
  window.setTimeout(() => {
    const placeholder = newTabPill();
    if (!hadNewTab && placeholder !== null) {
      const close = placeholder.querySelector("button[aria-label^='Close ']");
      if (close instanceof HTMLElement) close.click();
      if (attempts > 0) settleTerminalAfterShow(hadNewTab, attempts - 1);
      return;
    }
    const terminals = terminalPills();
    if (terminals.length > 0 && !terminals.some((terminal) => terminal.selected)) {
      (terminals[lastTerminalIndex] ?? terminals[0])?.select.click();
      return;
    }
    if (attempts > 0) settleTerminalAfterShow(hadNewTab, attempts - 1);
  }, 120);
}

function selectTerminal() {
  const terminals = terminalPills();
  if (terminals.some((terminal) => terminal.selected)) return;
  (terminals[lastTerminalIndex] ?? terminals[0])?.select.click();
}

const INFO_PANE_WIDTH = 340;
const TERMINAL_PANE_MIN = 320;
const CHAT_PANE_MIN = 320;

function paneRow(aside: HTMLElement): HTMLElement | null {
  const row = aside.parentElement?.parentElement;
  return row instanceof HTMLElement ? row : null;
}

function canSplitPanes(): boolean {
  const aside = rightAside();
  const row = aside === null ? null : paneRow(aside);
  if (row === null) return false;
  return row.clientWidth - CHAT_PANE_MIN >= INFO_PANE_WIDTH + TERMINAL_PANE_MIN;
}

const paneFlexOriginal = new WeakMap<HTMLElement, string>();

function overrideFlex(node: HTMLElement, value: string) {
  if (node.style.getPropertyPriority("flex") !== "important") paneFlexOriginal.set(node, node.style.getPropertyValue("flex"));
  if (node.style.getPropertyValue("flex") !== value || node.style.getPropertyPriority("flex") !== "important") {
    node.style.setProperty("flex", value, "important");
  }
}

function restoreFlex(node: HTMLElement) {
  if (node.style.getPropertyPriority("flex") !== "important") return;
  const original = paneFlexOriginal.get(node);
  node.style.removeProperty("flex");
  if (original !== undefined && original !== "") node.style.setProperty("flex", original);
  paneFlexOriginal.delete(node);
}

function clearPaneFit(aside: HTMLElement) {
  if (aside.dataset.paneFit !== undefined) delete aside.dataset.paneFit;
  if (aside.style.getPropertyValue("--secondary-swipe-width") !== "" && aside.style.getPropertyValue("--secondary-swipe-width") !== "50cqw") {
    aside.style.setProperty("--secondary-swipe-width", "50cqw");
  }
  const panel = aside.parentElement;
  const thread = paneRow(aside)?.firstElementChild;
  if (panel instanceof HTMLElement) restoreFlex(panel);
  if (thread instanceof HTMLElement && thread !== panel) restoreFlex(thread);
}

function fitSplitPanes(aside: HTMLElement) {
  const row = paneRow(aside);
  const panel = aside.parentElement;
  const thread = row?.firstElementChild;
  if (row === null || !(panel instanceof HTMLElement) || !(thread instanceof HTMLElement) || thread === panel) return;
  const minimum = INFO_PANE_WIDTH + TERMINAL_PANE_MIN;
  const total = row.clientWidth;
  aside.dataset.paneFit = "split";
  const wanted = Math.min(Math.max(Math.round(total * 0.68), minimum), total - CHAT_PANE_MIN);
  overrideFlex(panel, `${wanted} 1 0px`);
  overrideFlex(thread, `${total - wanted} 1 0px`);
  aside.style.setProperty("--secondary-swipe-width", `${wanted}px`);
}

function classifyPaneKind(overlay: HTMLElement): "tabs" | "info" {
  const terminal = overlay.querySelector(".xterm, svg[data-icon='Terminal'], svg[data-icon='NewTab']");
  return terminal !== null ? "tabs" : "info";
}

function paintPaneView() {
  const aside = rightAside();
  if (aside === null) return;
  const inner = aside.firstElementChild;
  const overlays = inner instanceof HTMLElement
    ? [...inner.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.className.toString().includes("absolute"))
    : [];
  if (overlays.length !== 2) {
    if (aside.dataset.paneView !== undefined) delete aside.dataset.paneView;
    clearPaneFit(aside);
    return;
  }
  const first = overlays[0];
  const second = overlays[1];
  if (first === undefined || second === undefined) return;
  let kinds = [classifyPaneKind(first), classifyPaneKind(second)];
  if (kinds[0] === kinds[1]) kinds = ["info", "tabs"];
  overlays.forEach((overlay, index) => {
    const kind = kinds[index] ?? "info";
    if (overlay.dataset.paneKind !== kind) overlay.dataset.paneKind = kind;
  });
  if (paneView === "both" && !canSplitPanes()) paneView = "terminal";
  if (aside.dataset.paneView !== paneView) aside.dataset.paneView = paneView;
  if (paneView === "both" && rightPanelOpen()) fitSplitPanes(aside);
  else clearPaneFit(aside);
}

function openRightPanelWith(view: PaneView, settle: boolean) {
  paneView = view;
  paintPaneView();
  expectPanel(true);
  toggleRightPanelKey();
  if (settle && terminalPills().length > 0) settleTerminalAfterShow(newTabPill() !== null, 8);
}

function onInfoClick() {
  if (!rightPanelOpen()) {
    openRightPanelWith("info", true);
    return;
  }
  if (!canSplitPanes()) {
    if (paneView === "info") {
      hideRightPanel();
      paneView = "both";
    } else paneView = "info";
  } else if (paneView === "both") paneView = "terminal";
  else if (paneView === "terminal") paneView = "both";
  else {
    hideRightPanel();
    paneView = "both";
  }
  paintPaneView();
}

function showInfoPane() {
  if (!rightPanelOpen()) {
    openRightPanelWith("info", true);
    return;
  }
  if (paneView === "terminal") paneView = canSplitPanes() ? "both" : "info";
  paintPaneView();
}

function onTerminalClick() {
  const terminals = terminalPills();
  const activeIndex = terminals.findIndex((terminal) => terminal.selected);
  if (activeIndex >= 0) lastTerminalIndex = activeIndex;
  if (terminals.length === 0) {
    return;
  }
  if (!rightPanelOpen()) {
    openRightPanelWith("terminal", true);
    return;
  }
  if (!canSplitPanes()) {
    if (paneView === "info") {
      paneView = "terminal";
      selectTerminal();
    } else {
      hideRightPanel();
      paneView = "both";
    }
  } else if (paneView === "both") paneView = "info";
  else if (paneView === "info") {
    paneView = "both";
    selectTerminal();
  } else {
    hideRightPanel();
    paneView = "both";
  }
  paintPaneView();
}

function bindPaneButtons() {
  if (paneButtonsBound) return;
  paneButtonsBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const info = target.closest("[data-thread-header-pane-actions] > button[aria-label*='right panel']");
    const terminal = target.closest("[data-workspace-windows] button[aria-label='Terminal']");
    const other = target.closest("[data-workspace-windows] button[aria-label='Browser'], [data-workspace-windows] button[aria-label='Files']");
    if (other !== null && paneView === "info") {
      paneView = "both";
      paintPaneView();
    }
    if (info === null && terminal === null) return;
    const now = Date.now();
    if (terminal instanceof HTMLElement && terminalPills().length === 0) {
      paneView = "terminal";
      paintPaneView();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (now < paneButtonUntil) return;
    paneButtonUntil = now + 400;
    if (info !== null) onInfoClick();
    else onTerminalClick();
  }, true);
}

const visionAnswers = new Map<string, { image: boolean | null; at: number }>();
const visionPending = new Set<string>();
let visionBlocked = false;
let visionBound = false;

function selectedModelName(box: Element): string {
  const button = box.parentElement?.querySelector('button[aria-label^="Provider, model"]') ?? document.querySelector('button[aria-label^="Provider, model"]');
  const label = button?.querySelector("span.truncate");
  return label?.textContent?.trim() ?? "";
}

function requestVision(name: string) {
  if (name === "" || visionPending.has(name)) return;
  const known = visionAnswers.get(name);
  if (known !== undefined && Date.now() - known.at < 600000) return;
  visionPending.add(name);
  void fetch("/api/v1/plugins/boltrig-agent-editor/rpc/modelVision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ displayName: name }),
  })
    .then((response) => response.ok ? response.json() as Promise<{ ok?: boolean; result?: { image: boolean | null } }> : null)
    .then((body) => {
      visionAnswers.set(name, { image: body?.ok === true ? body.result?.image ?? null : null, at: Date.now() });
    })
    .catch(() => {
      visionAnswers.set(name, { image: null, at: Date.now() });
    })
    .finally(() => visionPending.delete(name));
}

function bindVisionGuard() {
  if (visionBound) return;
  visionBound = true;
  document.addEventListener("click", (event) => {
    if (!visionBlocked) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-promptbox-submit-group] button") === null) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!visionBlocked || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("[data-promptbox]") === null) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function paintVisionGuard() {
  bindVisionGuard();
  const box = document.querySelector("[data-promptbox]:not([data-promptbox-compact])");
  let blocked = false;
  let message = "";
  if (box instanceof HTMLElement) {
    const images = box.querySelectorAll("button.cursor-zoom-in img");
    if (images.length > 0) {
      const name = selectedModelName(box);
      requestVision(name);
      if (visionAnswers.get(name)?.image === false) {
        blocked = true;
        message = `${name} can't read images. Remove the attached image or choose a model with vision before sending.`;
      }
    }
  }
  visionBlocked = blocked;
  const existing = document.querySelector("[data-seat-vision-warning]");
  if (!blocked || !(box instanceof HTMLElement)) {
    existing?.remove();
    return;
  }
  if (existing instanceof HTMLElement) {
    if (existing.textContent !== message) existing.textContent = message;
    return;
  }
  const warning = document.createElement("div");
  warning.dataset.seatVisionWarning = "true";
  warning.setAttribute("role", "alert");
  warning.textContent = message;
  box.insertBefore(warning, box.firstChild);
}

let colourProbe: CanvasRenderingContext2D | null = null;

function rgbOf(css: string): [number, number, number] | null {
  if (colourProbe === null) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colourProbe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (colourProbe === null) return null;
  colourProbe.clearRect(0, 0, 1, 1);
  colourProbe.fillStyle = "#000";
  colourProbe.fillStyle = css;
  colourProbe.fillRect(0, 0, 1, 1);
  const data = colourProbe.getImageData(0, 0, 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

function paintTerminalWhite() {
  const terminals = document.querySelectorAll(".xterm");
  const root = document.documentElement;
  if (terminals.length === 0) return;
  const first = terminals[0];
  if (!(first instanceof HTMLElement)) return;
  const rgb = rgbOf(getComputedStyle(root).getPropertyValue("--sidebar").trim() || getComputedStyle(first).backgroundColor);
  const light = rgb !== null && Math.min(...rgb) >= 235;
  if (!light) {
    if (root.dataset.seatTermLight) delete root.dataset.seatTermLight;
    for (const canvas of document.querySelectorAll<HTMLElement>(".xterm canvas")) canvas.style.removeProperty("filter");
    return;
  }
  const lift = 255 / Math.max(...rgb, 1);
  const filter = lift > 1.0005 ? `brightness(${lift.toFixed(4)})` : "";
  if (root.dataset.seatTermLight !== "true") root.dataset.seatTermLight = "true";
  for (const canvas of document.querySelectorAll<HTMLElement>(".xterm canvas")) {
    if (canvas.style.filter !== filter) {
      if (filter) canvas.style.setProperty("filter", filter);
      else canvas.style.removeProperty("filter");
    }
  }
}

function paintPaneChrome() {
  paintTerminalWhite();
  bindPaneButtons();
  paintPaneView();
  paintPaneInfoIcon();
  placePanelUnderHeader();
  aliasPermissionLabel();
  alignComposerMeta();
  paintContextRing();
  paintVisionGuard();
  placeSeatPicker();
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

function focusComposerSoon() {
  let attempts = 0;
  const tryFocus = () => {
    attempts += 1;
    const editor = document.querySelector("[data-promptbox] .ProseMirror");
    if (editor instanceof HTMLElement) {
      if (document.activeElement !== editor) editor.focus();
      return;
    }
    if (attempts < 8) window.setTimeout(tryFocus, 250);
  };
  window.setTimeout(tryFocus, 600);
}

let clickToken = 0;

function seatMode(seatId: string) {
  writeMode(seatId);
  pinSeatName(seatId);
}

function sidePad(depth: number): CSSProperties {
  return { paddingLeft: 8 + depth * 16 };
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
      className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-[13px] hover:bg-state-hover active:bg-state-hover"
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
      data-fold-mark=""
      style={{ transform: open ? "rotate(45deg)" : "rotate(-45deg)", marginBottom: open ? 2 : 0, transition: "transform 150ms ease" }}
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
  if (!present) return <span data-fold-space="" className="h-7 w-7 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:text-foreground ${focusRing}`}
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

const seatTreeCacheKey = "boltrig.seatTreeCache";

function readSeatTreeCache(): { nodes: Node[] } | null {
  try {
    const raw = localStorage.getItem(seatTreeCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { nodes?: unknown; company?: unknown };
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
    const nodes = parsed.nodes as Node[];
    if (typeof parsed.company === "string") phoneWorkspaceName = parsed.company;
    indexNodes(nodes);
    return { nodes };
  } catch {
    return null;
  }
}

function writeSeatTreeCache(nodes: Node[]) {
  try {
    localStorage.setItem(seatTreeCacheKey, JSON.stringify({ nodes, company: phoneWorkspaceName }));
  } catch {
    return;
  }
}

export function SeatSidebar({ onNavigate, activeThreadId }: PluginThreadListProps) {
  const rpc = useRpc<typeof agentEditorRpc>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [cached] = useState(readSeatTreeCache);
  const [nodes, setNodes] = useState<Node[]>(() => cached?.nodes ?? []);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    if (!cached) return new Set();
    const active = sessionStorage.getItem(folderKey) ?? sessionStorage.getItem(activeKey);
    return active ? withOnlyHead(cached.nodes, new Set(), active) : new Set();
  });
  const [status, setStatus] = useState<string | null>(null);
  const [ready, setReady] = useState(() => cached !== null);
  const [reload, setReload] = useState(0);
  const [currentThread, setCurrentThread] = useState<string | null>(() => {
    const match = window.location.pathname.match(/\/threads\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  });
  const [environments, setEnvironments] = useState<Array<{ id: string; label: string }>>([]);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [onHome, setOnHome] = useState(false);
  const [activeSeat, setActiveSeat] = useState<string | null>(() => sessionStorage.getItem(activeKey));
  const [activeFolder, setActiveFolder] = useState<string | null>(() => sessionStorage.getItem(folderKey));

  useEffect(() => {
    void Promise.all([
      rpc.call("seats", null),
      rpc.call("folders", null).catch(() => ({ folders: [] as SeatFolder[], company: "" })),
    ]).then(([result, homes]) => {
      phoneWorkspaceName = homes.company;
      const next = homeRows(result.seats, homes.folders);
      indexNodes(next);
      publishHeadTrees(next);
      const active = sessionStorage.getItem(folderKey) ?? sessionStorage.getItem(activeKey);
      writeSeatTreeCache(next);
      setNodes(next);
      setOpen((current) => (cached !== null && current.size > 0) ? current : active ? withOnlyHead(next, new Set(), active) : new Set());
      setStatus(null);
      setReady(true);
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
      setReady(true);
    });
  }, [rpc, reload]);

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
    paintPaneChrome();
    paintSeatName();
    fitPhoneSidebar();
    const onMove = () => {
      paintSeatName();
      fitPhoneSidebar();
      paintPaneChrome();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);

  useEffect(() => {
    paintPaneChrome();
    const timer = window.setInterval(() => {
      paintSeatName();
      fitPhoneSidebar();
      paintPaneChrome();
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
        });
        focusComposerSoon();
        seatMode(seatId);
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
      sessionStorage.setItem(pendingKey, key);
      sessionStorage.setItem(leftKey, visible ?? "");
      seatMode(seat.id);
      navigate.toCompose({
        ...(workspace ? { projectId: workspace.projectId } : {}),
        ...(workspace?.environmentId ? { environmentId: workspace.environmentId } : {}),
        agent: seat.id,
      });
      focusComposerSoon();
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
          <Disclose name={name} expanded={expanded} present={disclose} onClick={() => toggle(key)} />
        </SeatRow>
        {expanded && disclose ? children.map((child) => renderFolder(child, depth + 1)) : null}
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
          <Disclose
            name={name}
            expanded={expanded}
            present={children.length > 0}
            onClick={() => shown(node) ? toggle(key) : openSeat(node)}
          />
        </SeatRow>
        {expanded && children.length > 0 ? <div role="group" aria-label={`${name} folders`}>{children.map((child) => renderFolder(child, 1))}</div> : null}
      </div>
    );
  };

  const newSession = !activeThreadId && !currentThread;
  const pickerKey = activeFolder ?? activeSeat;
  const pickerHead = nodes.find((node) => nodeKey(node) === headKeyFor(nodes, pickerKey)) ?? nodes[0] ?? null;
  const openEnvironments = () => {
    setEnvironmentOpen((open) => !open);
    const seatId = activeSeat;
    if (!seatId) return;
    const folder = activeFolder;
    const name = folder?.split("/").pop() || seatId;
    void (folder ? workspaceForPath(folder, name) : workspaceForSeat(seatId)).then(async (workspace) => {
      if (!workspace) return;
      const listed = await sdk.environments.list({ projectId: workspace.projectId });
      const rows = (Array.isArray(listed) ? listed : []).map((environment) => {
        const path = "path" in environment && typeof environment.path === "string" ? environment.path : "";
        const named = "name" in environment && typeof environment.name === "string" ? environment.name.trim() : "";
        const label = named || path.split("/").filter(Boolean).pop() || environment.id;
        return { id: environment.id, label };
      });
      setEnvironments(rows);
    }).catch(() => setEnvironments([]));
  };
  const chooseEnvironment = (environmentId: string) => {
    const seatId = activeSeat;
    if (!seatId) return;
    const folder = activeFolder;
    const name = folder?.split("/").pop() || seatId;
    void (folder ? workspaceForPath(folder, name) : workspaceForSeat(seatId)).then((workspace) => {
      if (!workspace) return;
      navigate.toCompose({
        projectId: workspace.projectId,
        environmentId,
        agent: seatId,
      });
      focusComposerSoon();
    }).catch(() => undefined);
  };
  const folderIcon = (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.4l1.1 1.2h6.1A1.2 1.2 0 0 1 14 5.4v6.4a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V4.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
  const checkIcon = (
    <svg data-seat-picker-check="" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3.5 8.2 6.4 11 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <>
    {newSession && pickerHead ? (
      <div data-seat-picker="" role="menu" aria-label="Agent">
        <button type="button" role="menuitem" onClick={() => openSeat(pickerHead)}>
          {folderIcon}
          <span className="min-w-0 flex-1 truncate">{rowName(pickerHead)}</span>
          {pickerKey === nodeKey(pickerHead) ? checkIcon : null}
        </button>
        {pickerHead.children.map((child) => (
          <button key={nodeKey(child)} type="button" role="menuitem" onClick={() => openSeat(child)}>
            {folderIcon}
            <span className="min-w-0 flex-1 truncate">{rowName(child)}</span>
            {pickerKey === nodeKey(child) ? checkIcon : null}
          </button>
        ))}
        <div data-seat-picker-rule="" />
        <button type="button" role="menuitem" onClick={openEnvironments}>
          <span className="min-w-0 flex-1 truncate">Choose environment</span>
          <span aria-hidden="true">{environmentOpen ? "▴" : "▾"}</span>
        </button>
        {environmentOpen ? environments.map((environment) => (
          <button key={environment.id} type="button" role="menuitem" onClick={() => chooseEnvironment(environment.id)}>
            <span className="min-w-0 flex-1 truncate">{environment.label}</span>
          </button>
        )) : null}
      </div>
    ) : null}
    <nav aria-label="Seats" className="flex flex-col px-2 py-1 text-sm">
      {nodes.length === 0 ? (
        <p className="flex flex-wrap items-center gap-2 px-2 py-1 text-[13px] text-muted-foreground">
          <span>{status ?? (ready ? "No heads, VPs, or PMs are installed." : "Loading seats")}</span>
          {status ? <button type="button" className={`underline ${focusRing}`} style={quietButton} onClick={() => { setStatus(null); setReady(false); setReload((count) => count + 1); }}>Try again</button> : null}
        </p>
      ) : nodes.map((node) => node.seat.tier === "head" ? renderHead(node) : renderFolder(node, 0))}
    </nav>
    </>
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
          <button type="button" title={row.title} onClick={() => navigate.toThread(row.id)} className={`flex h-7 w-full cursor-pointer items-center truncate rounded-md px-2 text-left text-[13px] text-foreground hover:bg-state-hover ${focusRing}`} style={{ userSelect: "none" }}>
            {row.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

let styleGuardInstalled = false;

function installStyleGuard() {
  if (styleGuardInstalled) return;
  styleGuardInstalled = true;
  ensureComposerBar();
  new MutationObserver(() => {
    if (!document.head.querySelector("style[data-seat-composer-bar]")) ensureComposerBar();
  }).observe(document.head, { childList: true });
  const reapply = () => {
    ensureComposerBar();
    paintPaneChrome();
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      const result = original(...args);
      window.requestAnimationFrame(reapply);
      return result;
    };
  }
  window.addEventListener("popstate", () => window.requestAnimationFrame(reapply));
}

installStyleGuard();
