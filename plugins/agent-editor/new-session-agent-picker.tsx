import { seatTone } from "./chrome.js";
import {
  buildGroups,
  flatten,
  isSidebarSelection,
  needsSearch,
  parseFolders,
  parseSeats,
  resolveCurrent,
  stepIndex,
  visibleGroups,
  type PickerEntry,
  type PickerGroup,
} from "./new-session-agent-picker-model.js";

const activeKey = "boltrig.activeSeat";
const folderKey = "boltrig.activeFolder";
const lastUsedKey = "boltrig.newSessionAgent";
const cacheKey = "boltrig.newSessionAgentCache";
const disposeKey = "__boltrigAgentPickerDispose";
const rpcBase = "/api/v1/plugins/boltrig-agent-editor/rpc";

const STYLE = `
[data-agent-picker-host] {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 3;
  height: 28px;
  margin-top: -28px;
  padding: 0 0 0 16px;
  max-width: calc(100% - 200px);
  box-sizing: border-box;
  pointer-events: none;
}
[data-agent-picker-chip] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 100%;
  padding: 0 8px 0 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #191919;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
}
[data-agent-picker-chip]:hover,
[data-agent-picker-chip][aria-expanded="true"] {
  background: var(--state-hover, rgb(0 0 0 / 5%));
}
[data-agent-picker-chip]:focus-visible {
  outline: 1px solid var(--ring, #9a9a9a);
  outline-offset: 0;
}
[data-agent-picker-chip] [data-agent-picker-label] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-agent-picker-chip] svg[data-agent-picker-chevron] {
  flex: none;
  color: #a3a3a3;
}
[data-agent-picker-mark] {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}
[data-agent-picker-pop] {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: 280px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 12px;
  background: var(--background, #fff);
  color: #191919;
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
  padding: 4px;
  font-size: 13px;
  outline: none;
}
[data-agent-picker-pop] input {
  flex: none;
  height: 32px;
  margin: 0 0 4px;
  padding: 0 8px;
  border: 0;
  border-bottom: 1px solid var(--border, #e5e5e5);
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}
[data-agent-picker-pop] input::placeholder {
  color: #a3a3a3;
}
[data-agent-picker-list] {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
[data-agent-picker-pop] [role="option"],
[data-agent-picker-pop] [data-agent-picker-more] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
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
[data-agent-picker-pop] [role="option"][data-pointed="true"],
[data-agent-picker-pop] [data-agent-picker-more]:hover {
  background: var(--muted, rgb(0 0 0 / 5%));
}
[data-agent-picker-pop] [data-agent-picker-name] {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-agent-picker-pop] [data-agent-picker-role] {
  min-width: 0;
  flex: 1 1 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8f8f8f;
  font-size: 11px;
}
[data-agent-picker-pop] [data-agent-picker-check] {
  flex: none;
  margin-left: auto;
}
[data-agent-picker-pop] [data-agent-picker-rule] {
  flex: none;
  height: 1px;
  margin: 4px 8px;
  background: var(--border, #e5e5e5);
}
[data-agent-picker-pop] [data-agent-picker-empty] {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 0 8px;
  color: #8f8f8f;
}
[data-seat-picker] {
  display: none !important;
}
`;

interface Directory {
  seats: { id: string; tier: string }[];
  folders: { path: string; name: string; seat: string; tier: string }[];
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function readCache(): Directory | null {
  const raw = readStorage(localStorage, cacheKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const seats = parseSeats({ ok: true, result: { seats: Reflect.get(parsed, "seats") } });
    const folders = parseFolders({ ok: true, result: { folders: Reflect.get(parsed, "folders") } });
    return seats && folders ? { seats, folders } : null;
  } catch {
    return null;
  }
}

async function callRpc(name: string): Promise<unknown> {
  const response = await fetch(`${rpcBase}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  return response.json();
}

async function fetchDirectory(): Promise<Directory | null> {
  try {
    const [seatsRaw, foldersRaw] = await Promise.all([callRpc("seats"), callRpc("folders")]);
    const seats = parseSeats(seatsRaw);
    const folders = parseFolders(foldersRaw);
    if (!seats || !folders) return null;
    return { seats, folders };
  } catch {
    return null;
  }
}

function svg(markup: string): SVGSVGElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const node = holder.firstElementChild;
  if (!(node instanceof SVGSVGElement)) throw new Error("agent picker icon");
  return node;
}

function chevron(): SVGSVGElement {
  const node = svg('<svg data-agent-picker-chevron="" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6.2 8 10l4-3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  return node;
}

function checkIcon(): SVGSVGElement {
  const node = svg('<svg data-agent-picker-check="" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.2 6.4 11 12.5 4.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  return node;
}

function mark(entry: { seatId: string; name: string }): HTMLSpanElement {
  const node = document.createElement("span");
  node.dataset.agentPickerMark = "";
  node.setAttribute("aria-hidden", "true");
  node.style.backgroundColor = seatTone(entry.seatId);
  node.textContent = Array.from(entry.name.trim())[0]?.toUpperCase() ?? "?";
  return node;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function rowOf(key: string): Element | null {
  return document.querySelector(`[data-seat-row="${CSS.escape(key)}"]`);
}

function rowButton(key: string): HTMLButtonElement | null {
  const button = rowOf(key)?.querySelector(":scope > div > button");
  return button instanceof HTMLButtonElement ? button : null;
}

function discloseButton(key: string): HTMLButtonElement | null {
  const button = rowOf(key)?.querySelector(":scope > div > button[aria-expanded]");
  return button instanceof HTMLButtonElement ? button : null;
}

function composerAnchor(): HTMLElement | null {
  const footer = document.querySelector("[data-new-thread-footer]");
  const shell = footer?.closest("[data-promptbox-shell]");
  if (!(shell instanceof HTMLElement)) return null;
  let node: HTMLElement = shell;
  const compact = shell.closest('[data-testid="root-compose-compact-composer"]');
  if (compact instanceof HTMLElement) {
    while (node.parentElement && node.parentElement !== compact) node = node.parentElement;
    return node.parentElement === compact ? node : null;
  }
  while (node.parentElement && !(node.parentElement.classList.contains("flex") && node.parentElement.classList.contains("flex-col"))) {
    node = node.parentElement;
    if (node === document.body) return null;
  }
  return node.parentElement ? node : null;
}

export function installAgentPicker(): void {
  const previous = Reflect.get(window, disposeKey);
  if (typeof previous === "function") previous();

  let directory: Directory | null = readCache();
  let groups: PickerGroup[] = directory ? buildGroups(directory.seats, directory.folders) : [];
  let host: HTMLElement | null = null;
  let chip: HTMLButtonElement | null = null;
  let labelKey = "";
  let pop: HTMLElement | null = null;
  let query = "";
  let expanded = false;
  let pointed = -1;
  let defaultApplied = false;
  let busy = 0;
  let scheduled = false;
  let disposed = false;

  const style = document.createElement("style");
  style.dataset.agentPickerStyle = "";
  style.textContent = STYLE;
  document.head.appendChild(style);

  const currentEntry = (): PickerEntry | null => resolveCurrent(groups, {
    activeFolder: readStorage(sessionStorage, folderKey),
    activeSeat: readStorage(sessionStorage, activeKey),
    lastUsed: readStorage(localStorage, lastUsedKey),
  });

  const paintChip = () => {
    if (!chip) return;
    const current = currentEntry();
    const signature = current ? `${current.key}|${current.name}` : "";
    if (signature === labelKey && chip.childElementCount > 0) return;
    labelKey = signature;
    chip.replaceChildren();
    if (current) chip.appendChild(mark(current));
    const label = document.createElement("span");
    label.dataset.agentPickerLabel = "";
    label.textContent = current?.name ?? "Choose agent";
    chip.appendChild(label);
    chip.appendChild(chevron());
    chip.title = current ? `${current.role} · ${current.seatId}` : "Choose agent";
    chip.setAttribute("aria-label", `Agent: ${current?.name ?? "none"}`);
  };

  const closePop = (restoreFocus: boolean) => {
    if (!pop) return;
    pop.remove();
    pop = null;
    query = "";
    expanded = false;
    pointed = -1;
    chip?.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("resize", onViewport);
    if (restoreFocus) chip?.focus({ preventScroll: true });
  };

  const entriesShown = (): PickerEntry[] => flatten(visibleGroups(groups, { currentKey: currentEntry()?.key ?? null, expanded, query }));

  const activate = async (entry: PickerEntry) => {
    writeStorage(localStorage, lastUsedKey, entry.key);
    const token = ++busy;
    const current = currentEntry();
    const sidebarKey = readStorage(sessionStorage, folderKey) ?? readStorage(sessionStorage, activeKey);
    const already = sidebarKey !== null && (sidebarKey === entry.key || (!readStorage(sessionStorage, folderKey) && sidebarKey === entry.seatId));
    if (already && current?.key === entry.key) {
      paintChip();
      return;
    }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (disposed || token !== busy) return;
      const button = rowButton(entry.key);
      if (button) {
        button.click();
        await sleep(0);
        paintChip();
        return;
      }
      for (const ancestor of [...entry.ancestors].reverse()) {
        if (!rowButton(ancestor)) continue;
        const toggle = discloseButton(ancestor);
        if (toggle && toggle.getAttribute("aria-expanded") === "false") toggle.click();
        break;
      }
      await sleep(60);
    }
  };

  const renderPop = () => {
    if (!pop) return;
    const shown = visibleGroups(groups, { currentKey: currentEntry()?.key ?? null, expanded, query });
    const flat = flatten(shown);
    const currentKey = currentEntry()?.key ?? null;
    if (pointed >= flat.length) pointed = flat.length - 1;
    const hadFocus = document.activeElement instanceof HTMLInputElement && pop.contains(document.activeElement);
    pop.replaceChildren();
    if (needsSearch(groups)) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = query;
      input.placeholder = "Search agents";
      input.setAttribute("aria-label", "Search agents");
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("input", () => {
        query = input.value;
        pointed = query.trim() ? 0 : -1;
        renderPop();
      });
      pop.appendChild(input);
      if (hadFocus || !pop.dataset.focused) {
        pop.dataset.focused = "true";
        queueMicrotask(() => {
          input.focus({ preventScroll: true });
          const end = input.value.length;
          input.setSelectionRange(end, end);
        });
      }
    }
    const list = document.createElement("div");
    list.dataset.agentPickerList = "";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Agents");
    if (flat.length === 0) {
      const empty = document.createElement("div");
      empty.dataset.agentPickerEmpty = "";
      empty.textContent = directory ? "Nothing matches." : "Loading agents";
      list.appendChild(empty);
    }
    let index = 0;
    shown.forEach((group, groupIndex) => {
      if (groupIndex > 0 && (expanded || query.trim())) {
        const rule = document.createElement("div");
        rule.dataset.agentPickerRule = "";
        list.appendChild(rule);
      }
      for (const entry of group.entries) {
        const option = document.createElement("button");
        const position = index;
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", entry.key === currentKey ? "true" : "false");
        option.dataset.agentKey = entry.key;
        option.dataset.pointed = position === pointed ? "true" : "false";
        option.style.paddingLeft = `${8 + Math.min(entry.depth, 3) * 12}px`;
        option.tabIndex = -1;
        const name = document.createElement("span");
        name.dataset.agentPickerName = "";
        name.textContent = entry.name;
        const role = document.createElement("span");
        role.dataset.agentPickerRole = "";
        role.textContent = entry.role;
        option.append(mark(entry), name, role);
        if (entry.key === currentKey) option.appendChild(checkIcon());
        option.title = `${entry.role} · ${entry.seatId}`;
        option.addEventListener("mouseenter", () => {
          pointed = position;
          pop?.querySelectorAll('[role="option"]').forEach((node) => {
            if (node instanceof HTMLElement) node.dataset.pointed = node === option ? "true" : "false";
          });
        });
        option.addEventListener("click", () => {
          closePop(false);
          void activate(entry);
        });
        list.appendChild(option);
        index += 1;
      }
    });
    pop.appendChild(list);
    const rule = document.createElement("div");
    rule.dataset.agentPickerRule = "";
    pop.appendChild(rule);
    const more = document.createElement("button");
    more.type = "button";
    more.dataset.agentPickerMore = "";
    const moreLabel = document.createElement("span");
    moreLabel.textContent = "Choose agent…";
    moreLabel.style.flex = "1 1 auto";
    more.append(moreLabel, chevron());
    more.setAttribute("aria-expanded", expanded ? "true" : "false");
    more.addEventListener("click", () => {
      expanded = !expanded;
      pop?.removeAttribute("data-focused");
      renderPop();
    });
    pop.appendChild(more);
    placePop();
    const target = pop.querySelector('[data-pointed="true"]');
    if (target instanceof HTMLElement) target.scrollIntoView({ block: "nearest" });
  };

  function placePop() {
    if (!pop || !chip) return;
    const rect = chip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 288));
    const above = rect.top - 12;
    const below = window.innerHeight - rect.bottom - 12;
    const openUp = above >= Math.min(240, below) || above > below;
    pop.style.left = `${Math.round(left)}px`;
    if (openUp) {
      pop.style.top = "auto";
      pop.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
      pop.style.maxHeight = `${Math.max(120, Math.min(420, above))}px`;
    } else {
      pop.style.bottom = "auto";
      pop.style.top = `${Math.round(rect.bottom + 6)}px`;
      pop.style.maxHeight = `${Math.max(120, Math.min(420, below))}px`;
    }
  }

  function onOutside(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (pop?.contains(target) || chip?.contains(target)) return;
    closePop(false);
  }

  function onViewport() {
    placePop();
  }

  const onPopKey = (event: KeyboardEvent) => {
    if (!pop) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) {
        query = "";
        pointed = -1;
        renderPop();
      } else closePop(true);
      return;
    }
    const flat = entriesShown();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      pointed = stepIndex(pointed, event.key === "ArrowDown" ? 1 : -1, flat.length);
      renderPop();
      return;
    }
    if (event.key === "Enter") {
      const entry = flat[pointed];
      if (!entry) return;
      event.preventDefault();
      closePop(true);
      void activate(entry);
    }
  };

  const openPop = () => {
    if (pop || !chip) return;
    pop = document.createElement("div");
    pop.dataset.agentPickerPop = "";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Agent");
    pop.tabIndex = -1;
    pop.addEventListener("keydown", onPopKey);
    document.body.appendChild(pop);
    chip.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("resize", onViewport);
    const current = currentEntry();
    pointed = current ? entriesShown().findIndex((entry) => entry.key === current.key) : -1;
    renderPop();
    if (!needsSearch(groups)) pop.focus({ preventScroll: true });
    void fetchDirectory().then((fresh) => {
      if (!fresh || disposed) return;
      applyDirectory(fresh);
      if (pop) renderPop();
    });
  };

  function applyDirectory(next: Directory) {
    directory = next;
    groups = buildGroups(next.seats, next.folders);
    writeStorage(localStorage, cacheKey, JSON.stringify(next));
    labelKey = "";
    paintChip();
  }

  const ensureHost = () => {
    const anchor = composerAnchor();
    if (!anchor) {
      if (host) {
        closePop(false);
        host.remove();
        host = null;
        chip = null;
        labelKey = "";
      }
      return;
    }
    if (host && host.isConnected && host.previousElementSibling === anchor) return;
    if (host) host.remove();
    host = document.createElement("div");
    host.dataset.agentPickerHost = "";
    chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.agentPickerChip = "";
    chip.setAttribute("aria-haspopup", "dialog");
    chip.setAttribute("aria-expanded", "false");
    chip.addEventListener("click", () => {
      if (pop) closePop(false);
      else openPop();
    });
    host.appendChild(chip);
    anchor.after(host);
    labelKey = "";
    paintChip();
  };

  const applyDefault = () => {
    if (defaultApplied || !directory) return;
    const entries = flatten(groups);
    if (isSidebarSelection({ activeFolder: readStorage(sessionStorage, folderKey), activeSeat: readStorage(sessionStorage, activeKey), lastUsed: null }, entries)) {
      defaultApplied = true;
      return;
    }
    const remembered = readStorage(localStorage, lastUsedKey);
    const entry = remembered ? entries.find((item) => item.key === remembered) : undefined;
    if (!entry) return;
    if (!rowOf(entry.key) && !rowOf(entry.headKey)) return;
    defaultApplied = true;
    void activate(entry);
  };

  const tick = () => {
    scheduled = false;
    if (disposed) return;
    ensureHost();
    paintChip();
    applyDefault();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(tick);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          schedule();
          return;
        }
      }
      if (record.removedNodes.length > 0) {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setInterval(tick, 400);
  tick();

  void fetchDirectory().then((fresh) => {
    if (fresh && !disposed) applyDirectory(fresh);
  });

  Reflect.set(window, disposeKey, () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(timer);
    closePop(false);
    host?.remove();
    style.remove();
  });
}
