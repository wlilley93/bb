/// <reference path="./react-dom-shim.d.ts" />
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  dedupeAcrossRuntimes,
  flattenBlocks,
  pushRecent,
  searchEverything,
  splitMainAndMore,
  stepIndex,
  toPickerModel,
  type GroupBlock,
  type PickerModel,
  type RawModel,
  type RuntimeInfo,
} from "./model-picker-logic.js";

interface ChoiceOption {
  value: string;
  label: string;
}

interface ModelOption {
  value: string;
  label: string;
  routeProviderId?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface TierOption {
  id: string;
  label: string;
  description?: string;
}

interface AgentItem {
  key: string;
  label: string;
  value: unknown;
  selected: boolean;
}

interface AgentSection {
  id: string;
  label: string;
  items: AgentItem[];
}

interface Routing {
  environmentId: string | null;
  hostId: string | null;
}

type StringHandler = (value: string) => void;
type AgentHandler = (id: string, value: unknown) => void;

interface PickerProps {
  providers: ChoiceOption[];
  routing: Routing;
  selectedProviderId: string;
  onSelectedProviderChange: StringHandler | null;
  hasMultipleProviders: boolean;
  modelValue: string;
  modelOptions: ModelOption[];
  moreModelOptions: ModelOption[];
  modelIsLoading: boolean;
  modelLoadFailed: boolean;
  onModelChange: StringHandler;
  reasoningValue: string;
  reasoningOptions: ChoiceOption[];
  onReasoningChange: StringHandler | null;
  serviceTierValue: string | null;
  serviceTierOptions: TierOption[];
  onServiceTierChange: StringHandler | null;
  agentSections: AgentSection[];
  onAgentOptionChange: AgentHandler | null;
  hasHandoff: boolean;
  disabled: boolean;
}

interface FiberLike {
  tag: number;
  return: FiberLike | null;
  child: FiberLike | null;
  sibling: FiberLike | null;
  stateNode: unknown;
  memoizedProps: unknown;
  alternate: FiberLike | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiber(value: unknown): value is FiberLike {
  return isRecord(value) && typeof value["tag"] === "number" && "memoizedProps" in value && "stateNode" in value;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function handler<F>(value: unknown): F | null {
  return typeof value === "function" ? (value as F) : null;
}

function readChoices(value: unknown, valueKey: string): ChoiceOption[] {
  const out: ChoiceOption[] = [];
  for (const entry of list(value)) {
    if (!isRecord(entry)) continue;
    const id = text(entry[valueKey]);
    const label = text(entry["label"]);
    if (id !== null && label !== null) out.push({ value: id, label });
  }
  return out;
}

function readModelOptions(value: unknown): ModelOption[] {
  const out: ModelOption[] = [];
  for (const entry of list(value)) {
    if (!isRecord(entry)) continue;
    const id = text(entry["value"]);
    const label = text(entry["label"]);
    if (id === null || label === null) continue;
    const option: ModelOption = { value: id, label };
    const route = text(entry["routeProviderId"]);
    if (route !== null) option.routeProviderId = route;
    if (entry["disabled"] === true) option.disabled = true;
    const reason = text(entry["disabledReason"]);
    if (reason !== null) option.disabledReason = reason;
    out.push(option);
  }
  return out;
}

function readTiers(value: unknown): TierOption[] {
  const out: TierOption[] = [];
  for (const entry of list(value)) {
    if (!isRecord(entry)) continue;
    const id = text(entry["id"]);
    const label = text(entry["label"]);
    if (id === null || label === null) continue;
    const tier: TierOption = { id, label };
    const description = text(entry["description"]);
    if (description !== null) tier.description = description;
    out.push(tier);
  }
  return out;
}

function readSections(value: unknown): AgentSection[] {
  const out: AgentSection[] = [];
  for (const entry of list(value)) {
    if (!isRecord(entry)) continue;
    const id = text(entry["id"]);
    const label = text(entry["label"]);
    if (id === null || label === null) continue;
    const items: AgentItem[] = [];
    for (const item of list(entry["items"])) {
      if (!isRecord(item)) continue;
      const key = text(item["key"]);
      const itemLabel = text(item["label"]);
      if (key === null || itemLabel === null) continue;
      items.push({ key, label: itemLabel, value: item["value"], selected: item["selected"] === true });
    }
    out.push({ id, label, items });
  }
  return out;
}

function readRouting(value: unknown): Routing {
  if (!isRecord(value)) return { environmentId: null, hostId: null };
  return { environmentId: text(value["environmentId"]), hostId: text(value["hostId"]) };
}

function parsePickerProps(value: unknown): PickerProps | null {
  if (!isRecord(value)) return null;
  const onModelChange = handler<StringHandler>(value["onModelChange"]);
  const providerId = text(value["selectedProviderId"]);
  const modelValue = text(value["modelValue"]);
  if (onModelChange === null || providerId === null || modelValue === null || !Array.isArray(value["providerOptions"]) || !Array.isArray(value["modelOptions"])) return null;
  return {
    providers: readChoices(value["providerOptions"], "value"),
    routing: readRouting(value["providerRouting"]),
    selectedProviderId: providerId,
    onSelectedProviderChange: handler<StringHandler>(value["onSelectedProviderChange"]),
    hasMultipleProviders: value["hasMultipleProviders"] === true,
    modelValue,
    modelOptions: readModelOptions(value["modelOptions"]),
    moreModelOptions: readModelOptions(value["moreModelOptions"]),
    modelIsLoading: value["modelIsLoading"] === true,
    modelLoadFailed: value["modelLoadFailed"] === true || isRecord(value["modelLoadError"]),
    onModelChange,
    reasoningValue: text(value["reasoningValue"]) ?? "",
    reasoningOptions: readChoices(value["reasoningOptions"], "value"),
    onReasoningChange: handler<StringHandler>(value["onReasoningChange"]),
    serviceTierValue: text(value["serviceTierValue"]),
    serviceTierOptions: readTiers(value["serviceTierOptions"]),
    onServiceTierChange: handler<StringHandler>(value["onServiceTierChange"]),
    agentSections: readSections(value["agentSections"]),
    onAgentOptionChange: handler<AgentHandler>(value["onAgentOptionChange"]),
    hasHandoff: isRecord(value["handoff"]),
    disabled: value["disabled"] === true,
  };
}

function fiberOf(node: Element): FiberLike | null {
  for (const key of Object.keys(node)) {
    if (!key.startsWith("__reactFiber$")) continue;
    const candidate: unknown = Reflect.get(node, key);
    if (isFiber(candidate)) return candidate;
  }
  return null;
}

function currentRoot(seed: FiberLike): FiberLike {
  let top = seed;
  while (top.return !== null) top = top.return;
  const container = top.stateNode;
  if (isRecord(container) && isFiber(container["current"])) return container["current"];
  return top;
}

function pathTo(start: FiberLike | null, target: Element, path: FiberLike[]): boolean {
  for (let node = start; node !== null; node = node.sibling) {
    path.push(node);
    if (node.stateNode === target) return true;
    if (pathTo(node.child, target, path)) return true;
    path.pop();
  }
  return false;
}

function findPickerProps(trigger: Element): PickerProps | null {
  const seed = fiberOf(trigger);
  if (seed === null) return null;
  const path: FiberLike[] = [];
  if (!pathTo(currentRoot(seed), trigger, path)) return null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const parsed = parsePickerProps(path[index]?.memoizedProps);
    if (parsed !== null) return parsed;
  }
  return null;
}

const TRIGGER_LABEL = "Provider, model and reasoning";
const API_BASE = "/api/v1";
const STALE_MS = 60_000;
const RECENTS_KEY = "bb-agent-editor-model-recents";
const GLOBAL_KEY = "__bbAgentEditorModelPicker";

interface RuntimeData {
  models: RawModel[];
  defaultValue: string | null;
  at: number;
}

const store = {
  version: 0,
  logos: new Map<string, string>(),
  logosAt: 0,
  logosBusy: false,
  runtimes: new Map<string, RuntimeData>(),
  busy: new Set<string>(),
  listeners: new Set<() => void>(),
};

function bump(): void {
  store.version += 1;
  for (const listener of store.listeners) listener();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function snapshot(): number {
  return store.version;
}

function routingKey(routing: Routing): string {
  return `${routing.environmentId ?? ""}/${routing.hostId ?? ""}`;
}

function queryFor(routing: Routing, extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (routing.environmentId !== null) params.set("environmentId", routing.environmentId);
  if (routing.hostId !== null) params.set("hostId", routing.hostId);
  const out = params.toString();
  return out.length > 0 ? `?${out}` : "";
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadLogos(routing: Routing): Promise<void> {
  if (store.logosBusy || Date.now() - store.logosAt < STALE_MS * 10) return;
  store.logosBusy = true;
  try {
    const body = await getJson(`${API_BASE}/system/providers${queryFor(routing, {})}`);
    const rows = Array.isArray(body) ? body : isRecord(body) ? list(body["providers"]) : [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = text(row["id"]);
      const logo = text(row["logoUrl"]);
      if (id !== null && logo !== null) store.logos.set(id, logo);
    }
    store.logosAt = Date.now();
    bump();
  } catch {
    store.logosAt = Date.now() - STALE_MS * 9;
  } finally {
    store.logosBusy = false;
  }
}

function parseRuntimeModels(body: unknown): RuntimeData {
  const models: RawModel[] = [];
  let defaultValue: string | null = null;
  const rows = isRecord(body) ? list(body["models"]) : [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = text(row["id"]);
    const name = text(row["displayName"]);
    if (id === null || name === null) continue;
    const isDefault = row["isDefault"] === true;
    if (isDefault && defaultValue === null) defaultValue = id;
    models.push({ value: id, label: name, routeProviderId: text(row["routeProviderId"]), isDefault });
  }
  const failed = isRecord(body) && isRecord(body["modelLoadError"]);
  return { models: failed ? [] : models, defaultValue, at: Date.now() };
}

async function loadRuntime(routing: Routing, runtimeId: string): Promise<void> {
  const key = `${routingKey(routing)}|${runtimeId}`;
  if (store.busy.has(key)) return;
  const held = store.runtimes.get(key);
  if (held !== undefined && Date.now() - held.at < STALE_MS) return;
  store.busy.add(key);
  try {
    const body = await getJson(`${API_BASE}/system/execution-options${queryFor(routing, { providerId: runtimeId })}`);
    store.runtimes.set(key, parseRuntimeModels(body));
    bump();
  } catch {
    store.runtimes.set(key, { models: [], defaultValue: null, at: Date.now() });
  } finally {
    store.busy.delete(key);
  }
}

function warm(props: PickerProps): void {
  void loadLogos(props.routing);
  const ids = props.providers.map((provider) => provider.value);
  for (const id of ids) void loadRuntime(props.routing, id);
}

function runtimeData(routing: Routing, runtimeId: string): RuntimeData | undefined {
  return store.runtimes.get(`${routingKey(routing)}|${runtimeId}`);
}

function readRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]");
    return list(parsed).filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writeRecents(values: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(values));
  } catch {
    return;
  }
}

function findTrigger(dialog: Element): HTMLElement | null {
  if (dialog.id.length === 0) return null;
  const node = document.querySelector(`[aria-controls="${CSS.escape(dialog.id)}"]`);
  if (!(node instanceof HTMLElement)) return null;
  return node.getAttribute("aria-label")?.startsWith(TRIGGER_LABEL) === true ? node : null;
}

function liveTrigger(trigger: HTMLElement): HTMLElement | null {
  if (trigger.isConnected) return trigger;
  const next = document.querySelector(`button[aria-label^="${TRIGGER_LABEL}"]`);
  return next instanceof HTMLElement ? next : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function allOptions(props: PickerProps): ModelOption[] {
  return [...props.modelOptions, ...props.moreModelOptions];
}

function closePopover(trigger: HTMLElement): void {
  const live = liveTrigger(trigger);
  if (live !== null && live.getAttribute("aria-expanded") === "true") live.click();
}

async function applyModel(trigger: HTMLElement, model: PickerModel): Promise<void> {
  const live = liveTrigger(trigger);
  if (live === null) return;
  const first = findPickerProps(live);
  if (first === null) return;
  if (model.runtimeId === first.selectedProviderId) {
    first.onModelChange(model.value);
    return;
  }
  if (first.onSelectedProviderChange === null) return;
  first.onSelectedProviderChange(model.runtimeId);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    await wait(60);
    const next = liveTrigger(trigger);
    const props = next === null ? null : findPickerProps(next);
    if (props === null || props.selectedProviderId !== model.runtimeId || props.modelIsLoading) continue;
    if (!allOptions(props).some((option) => option.value === model.value)) continue;
    props.onModelChange(model.value);
    return;
  }
}

interface MenuEntry {
  id: string;
  kind: "model" | "sub" | "toggle" | "action";
}

function Chevron(): ReactNode {
  return (
    <svg className="mp-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMark(): ReactNode {
  return (
    <svg className="mp-check" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Logo({ url, label }: { url: string | null; label: string }): ReactNode {
  if (url === null) return <span className="mp-logo mp-logo-letter" aria-hidden="true">{label.charAt(0).toUpperCase()}</span>;
  return <span className="mp-logo" aria-hidden="true" style={{ WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")` }} />;
}

interface ModelRowProps {
  model: PickerModel;
  domId: string;
  current: boolean;
  isDefault: boolean;
  active: boolean;
  showRuntime: boolean;
  onPick: (model: PickerModel) => void;
  onHover: () => void;
}

function ModelRow({ model, domId, current, isDefault, active, showRuntime, onPick, onHover }: ModelRowProps): ReactNode {
  return (
    <div
      id={domId}
      role="option"
      aria-selected={current}
      aria-disabled={model.disabled || undefined}
      data-active={active || undefined}
      data-current={current || undefined}
      data-disabled={model.disabled || undefined}
      className="mp-row"
      title={model.disabledReason ?? `${model.label} · ${model.runtimeLabel}`}
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={onHover}
      onClick={() => {
        if (!model.disabled) onPick(model);
      }}
    >
      <Logo url={model.logoUrl} label={model.runtimeLabel} />
      <span className="mp-name">{model.label}</span>
      {isDefault ? <span className="mp-pill">Default</span> : null}
      <span className="mp-spacer" />
      {showRuntime ? <span className="mp-runtime">{model.runtimeLabel}</span> : null}
      <span className="mp-tick">{current ? <CheckMark /> : null}</span>
    </div>
  );
}

interface FlyoutItem {
  id: string;
  label: string;
  selected: boolean;
  run: () => void;
}

function Flyout({ children, wide }: { children: ReactNode; wide?: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: boolean; up: boolean }>({ left: false, up: false });
  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const anchor = parent.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = anchor.right + width + 8 > window.innerWidth && anchor.left - width - 8 > 0;
    const up = anchor.top - 6 + height > window.innerHeight - 8;
    setPlace((held) => (held.left === left && held.up === up ? held : { left, up }));
  }, []);
  return (
    <div ref={ref} className="mp-fly" data-left={place.left || undefined} data-up={place.up || undefined} data-wide={wide || undefined} role="menu" onMouseDown={(event) => event.preventDefault()}>
      {children}
    </div>
  );
}

function FlyoutList({ items, active }: { items: FlyoutItem[]; active: number }): ReactNode {
  return (
    <>
      {items.map((item, index) => (
        <div
          key={item.id}
          id={`mp-fly-${item.id}`}
          role="menuitemradio"
          aria-checked={item.selected}
          data-active={index === active || undefined}
          className="mp-row mp-row-plain"
          onClick={item.run}
        >
          <span className="mp-name">{item.label}</span>
          <span className="mp-spacer" />
          <span className="mp-tick">{item.selected ? <CheckMark /> : null}</span>
        </div>
      ))}
    </>
  );
}

interface ViewProps {
  props: PickerProps;
  trigger: HTMLElement;
  onHandoff: () => void;
}

type FlyId = string | null;

function View({ props, trigger, onHandoff }: ViewProps): ReactNode {
  const uid = useId();
  const listId = `${uid}-list`;
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [fly, setFly] = useState<FlyId>(null);
  const [flyActive, setFlyActive] = useState(-1);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searching = query.trim().length > 0;

  useEffect(() => {
    warm(props);
  }, [props.routing.environmentId, props.routing.hostId, props.providers.length]);

  useEffect(() => {
    const focus = () => {
      const held = document.activeElement;
      if (held instanceof HTMLInputElement || held instanceof HTMLTextAreaElement) {
        if (held !== inputRef.current && rootRef.current?.contains(held) !== true && held.closest('[role="dialog"]') === null) return;
      }
      inputRef.current?.focus({ preventScroll: true });
    };
    focus();
    const frame = window.requestAnimationFrame(focus);
    const timers = [60, 160, 320].map((delay) => window.setTimeout(focus, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  const canSwitch = props.hasMultipleProviders && props.onSelectedProviderChange !== null && props.providers.length > 1 && !props.hasHandoff;
  const currentKey = `${props.selectedProviderId}::${props.modelValue}`;

  const universe = useMemo(() => {
    const runtimes = canSwitch ? props.providers : props.providers.filter((provider) => provider.value === props.selectedProviderId);
    const selected = runtimes.length > 0 ? runtimes : props.providers.filter((provider) => provider.value === props.selectedProviderId);
    const all: PickerModel[] = [];
    let defaultKey: string | null = null;
    for (const [index, runtime] of selected.entries()) {
      const info: RuntimeInfo = { id: runtime.value, label: runtime.label, logoUrl: store.logos.get(runtime.value) ?? null };
      const data = runtimeData(props.routing, runtime.value);
      const raws: RawModel[] =
        runtime.value === props.selectedProviderId
          ? allOptions(props).map((option) => ({
              value: option.value,
              label: option.label,
              routeProviderId: option.routeProviderId,
              disabled: option.disabled,
              disabledReason: option.disabledReason,
              isDefault: data?.defaultValue === option.value,
            }))
          : (data?.models ?? []);
      for (const raw of raws) all.push(toPickerModel(info, raw));
      if (index === 0 && data?.defaultValue != null) defaultKey = `${runtime.value}::${data.defaultValue}`;
    }
    const deduped = dedupeAcrossRuntimes(all, currentKey);
    return { ...deduped, defaultKey, total: all.length };
  }, [props, canSwitch, currentKey, store.version]);

  const split = useMemo(() => splitMainAndMore({ primary: universe.primary, alternates: universe.alternates, recents, currentKey }), [universe, recents, currentKey]);
  const shown: GroupBlock[] = useMemo(() => (searching ? searchEverything(universe, query) : split.main), [searching, universe, query, split]);
  const shownFlat = useMemo(() => flattenBlocks(shown), [shown]);

  const pick = useCallback(
    (model: PickerModel) => {
      const next = pushRecent(readRecents(), model.key);
      writeRecents(next);
      setRecents(next);
      void applyModel(trigger, model);
      closePopover(trigger);
    },
    [trigger],
  );

  const effortItems: FlyoutItem[] = useMemo(
    () =>
      props.reasoningOptions.map((option) => ({
        id: `effort-${option.value}`,
        label: option.label,
        selected: option.value === props.reasoningValue,
        run: () => {
          props.onReasoningChange?.(option.value);
          closePopover(trigger);
        },
      })),
    [props, trigger],
  );

  const singleTier = props.serviceTierOptions.length === 1 ? props.serviceTierOptions[0] : undefined;
  const tierItems: FlyoutItem[] = useMemo(() => {
    if (props.serviceTierOptions.length < 2) return [];
    return [{ id: "default", label: "Default" }, ...props.serviceTierOptions].map((option) => ({
      id: `speed-${option.id}`,
      label: option.label,
      selected: (props.serviceTierValue ?? "default") === option.id,
      run: () => {
        props.onServiceTierChange?.(option.id);
        closePopover(trigger);
      },
    }));
  }, [props, trigger]);

  const sections = useMemo(
    () =>
      props.agentSections.map((section) => {
        const on = section.items.find((item) => item.value === true);
        return { section, on };
      }),
    [props.agentSections],
  );

  const moreFlat = useMemo(() => flattenBlocks(split.more), [split]);
  const showMore = !searching && split.hasMore;

  const entries: MenuEntry[] = useMemo(() => {
    const out: MenuEntry[] = shownFlat.map((model) => ({ id: model.key, kind: "model" }));
    if (showMore) out.push({ id: "more", kind: "sub" });
    if (effortItems.length > 0) out.push({ id: "effort", kind: "sub" });
    if (tierItems.length > 0) out.push({ id: "speed", kind: "sub" });
    if (singleTier !== undefined) out.push({ id: "tier-toggle", kind: "toggle" });
    for (const { section, on } of sections) out.push({ id: `agent-${section.id}`, kind: on === undefined ? "sub" : "toggle" });
    if (props.hasHandoff) out.push({ id: "handoff", kind: "action" });
    return out;
  }, [shownFlat, showMore, effortItems.length, tierItems.length, singleTier, sections, props.hasHandoff]);

  const flyItems = useCallback(
    (id: string): FlyoutItem[] => {
      if (id === "effort") return effortItems;
      if (id === "speed") return tierItems;
      const section = sections.find((entry) => `agent-${entry.section.id}` === id);
      if (section === undefined) return [];
      return section.section.items.map((item) => ({
        id: `${section.section.id}-${item.key}`,
        label: item.label,
        selected: item.selected,
        run: () => {
          props.onAgentOptionChange?.(section.section.id, item.value);
          closePopover(trigger);
        },
      }));
    },
    [effortItems, tierItems, sections, props, trigger],
  );

  const toggleTier = useCallback(() => {
    if (singleTier === undefined) return;
    props.onServiceTierChange?.(props.serviceTierValue === singleTier.id ? "default" : singleTier.id);
  }, [props, singleTier]);

  const toggleAgent = useCallback(
    (sectionId: string, enabled: boolean) => {
      props.onAgentOptionChange?.(sectionId, enabled);
    },
    [props],
  );

  const activate = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (entry === undefined) return;
      if (entry.kind === "model") {
        const model = shownFlat[index];
        if (model !== undefined && !model.disabled) pick(model);
        return;
      }
      if (entry.kind === "sub") {
        setFly(entry.id);
        setFlyActive(entry.id === "more" ? 0 : Math.max(0, flyItems(entry.id).findIndex((item) => item.selected)));
        return;
      }
      if (entry.kind === "toggle") {
        if (entry.id === "tier-toggle") toggleTier();
        else {
          const found = sections.find((item) => `agent-${item.section.id}` === entry.id);
          if (found?.on !== undefined) toggleAgent(found.section.id, !found.on.selected);
        }
        return;
      }
      onHandoff();
    },
    [entries, shownFlat, pick, flyItems, toggleTier, toggleAgent, sections, onHandoff],
  );

  useEffect(() => {
    setActiveIndex(-1);
    setFly(null);
  }, [query]);

  useEffect(() => {
    const node = activeIndex >= 0 ? rootRef.current?.querySelector(`[data-entry="${activeIndex}"]`) : null;
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const flyEntryCount = fly === "more" ? moreFlat.length : fly === null ? 0 : flyItems(fly).length;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (fly !== null) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFlyActive((held) => stepIndex(held, event.key === "ArrowDown" ? 1 : -1, flyEntryCount));
        return;
      }
      if (event.key === "ArrowLeft" && (event.currentTarget.value.length === 0 || event.currentTarget.selectionStart === 0)) {
        event.preventDefault();
        setFly(null);
        return;
      }
      if (event.key === "Enter" && flyActive >= 0) {
        event.preventDefault();
        if (fly === "more") {
          const model = moreFlat[flyActive];
          if (model !== undefined && !model.disabled) pick(model);
        } else flyItems(fly)[flyActive]?.run();
        return;
      }
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setFly(null);
      setActiveIndex((held) => stepIndex(held, event.key === "ArrowDown" ? 1 : -1, entries.length));
      return;
    }
    if (event.key === "ArrowRight" && activeIndex >= 0 && entries[activeIndex]?.kind === "sub" && event.currentTarget.selectionStart === event.currentTarget.value.length) {
      event.preventDefault();
      activate(activeIndex);
      return;
    }
    if (event.key === "Enter") {
      if (activeIndex < 0) {
        if (searching && shownFlat.length > 0) {
          event.preventDefault();
          activate(0);
        }
        return;
      }
      event.preventDefault();
      activate(activeIndex);
    }
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target === inputRef.current || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    inputRef.current?.focus({ preventScroll: true });
  };

  let cursor = -1;
  const renderBlocks = (blocks: GroupBlock[], flyMode: boolean): ReactNode =>
    blocks.map((block) => (
      <div key={block.group} role="group" aria-label={block.group}>
        <div className="mp-group">{block.group}</div>
        {block.models.map((model) => {
          if (flyMode) {
            const position = moreFlat.indexOf(model);
            return (
              <ModelRow
                key={model.key}
                model={model}
                domId={`${uid}-more-${position}`}
                current={model.key === currentKey}
                isDefault={model.key === universe.defaultKey}
                active={flyActive === position}
                showRuntime={canSwitch}
                onPick={pick}
                onHover={() => setFlyActive(position)}
              />
            );
          }
          cursor += 1;
          const index = cursor;
          return (
            <div key={model.key} data-entry={index}>
              <ModelRow
                model={model}
                domId={`${uid}-opt-${index}`}
                current={model.key === currentKey}
                isDefault={model.key === universe.defaultKey}
                active={activeIndex === index}
                showRuntime={canSwitch}
                onPick={pick}
                onHover={() => {
                  setActiveIndex(index);
                  setFly(null);
                }}
              />
            </div>
          );
        })}
      </div>
    ));

  const subIndex = (id: string): number => entries.findIndex((entry) => entry.id === id);
  const renderSub = (id: string, label: string, value: string | null, items: ReactNode): ReactNode => {
    const index = subIndex(id);
    const open = fly === id;
    return (
      <div className="mp-anchor" data-entry={index} key={id}>
        <div
          className="mp-row mp-row-plain"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
          data-active={index === activeIndex || open || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={() => {
            setActiveIndex(index);
            setFly(id);
            setFlyActive(-1);
          }}
          onClick={() => activate(index)}
        >
          <span className="mp-name">{label}</span>
          <span className="mp-spacer" />
          {value !== null ? <span className="mp-value">{value}</span> : null}
          <Chevron />
        </div>
        {open ? items : null}
      </div>
    );
  };

  const renderToggle = (id: string, label: string, on: boolean, run: () => void): ReactNode => {
    const index = subIndex(id);
    return (
      <div
        key={id}
        data-entry={index}
        className="mp-row mp-row-plain"
        role="menuitemcheckbox"
        aria-checked={on}
        data-active={index === activeIndex || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onPointerEnter={() => {
          setActiveIndex(index);
          setFly(null);
        }}
        onClick={run}
      >
        <span className="mp-name">{label}</span>
        <span className="mp-spacer" />
        <span className="mp-switch" data-on={on || undefined} aria-hidden="true"><span /></span>
      </div>
    );
  };

  const effortLabel = props.reasoningOptions.find((option) => option.value === props.reasoningValue)?.label ?? null;
  const activeDescendant = activeIndex >= 0 && entries[activeIndex]?.kind === "model" ? `${uid}-opt-${activeIndex}` : undefined;
  const hasPinned = showMore || effortItems.length > 0 || tierItems.length > 0 || singleTier !== undefined || sections.length > 0 || props.hasHandoff;

  return (
    <div ref={rootRef} className="mp" onKeyDown={onRootKeyDown}>
      <div className="mp-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M17 17l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search models"
          aria-label="Search models"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="mp-list" id={listId} role="listbox" aria-label="Models">
        {shown.length > 0 ? renderBlocks(shown, false) : <div className="mp-empty">{universe.total === 0 ? "No models available" : "No models match your search"}</div>}
      </div>
      {hasPinned ? <div className="mp-sep" /> : null}
      {showMore
        ? renderSub(
            "more",
            "More models",
            null,
            <Flyout wide>
              <div className="mp-fly-scroll" role="listbox" aria-label="More models">{renderBlocks(split.more, true)}</div>
            </Flyout>,
          )
        : null}
      {effortItems.length > 0 ? renderSub("effort", "Effort", effortLabel, <Flyout><FlyoutList items={effortItems} active={flyActive} /></Flyout>) : null}
      {tierItems.length > 0 ? renderSub("speed", "Speed", tierItems.find((item) => item.selected)?.label ?? null, <Flyout><FlyoutList items={tierItems} active={flyActive} /></Flyout>) : null}
      {singleTier !== undefined ? renderToggle("tier-toggle", `${singleTier.label} mode`, props.serviceTierValue === singleTier.id, toggleTier) : null}
      {sections.map(({ section, on }) =>
        on !== undefined
          ? renderToggle(`agent-${section.id}`, section.label, on.selected, () => toggleAgent(section.id, !on.selected))
          : renderSub(`agent-${section.id}`, section.label, section.items.find((item) => item.selected)?.label ?? null, <Flyout><FlyoutList items={flyItems(`agent-${section.id}`)} active={flyActive} /></Flyout>),
      )}
      {props.hasHandoff ? (
        <div
          data-entry={subIndex("handoff")}
          className="mp-row mp-row-plain"
          role="menuitem"
          data-active={subIndex("handoff") === activeIndex || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={() => {
            setActiveIndex(subIndex("handoff"));
            setFly(null);
          }}
          onClick={onHandoff}
        >
          <span className="mp-name">Handoff to new thread</span>
        </div>
      ) : null}
    </div>
  );
}

const STYLE = `
button[aria-label^="${TRIGGER_LABEL}"] [data-promptbox-hide-compact]{color:#8c8c8c!important}
[data-bb-portaled-overlay][data-mp="on"]{
  --mp-ink:#191919;--mp-grey:#8c8c8c;--mp-hover:rgba(0,0,0,.055);--mp-active:rgba(0,0,0,.075);--mp-line:rgba(0,0,0,.08);
  --mp-blue:#1d6cf2;--mp-pill-bg:rgba(0,0,0,.06);--mp-pill-ink:#6b6b6b;--mp-card:#fff;
  width:320px!important;min-width:320px!important;max-width:320px!important;overflow:visible!important;
  border-radius:12px!important;border:1px solid var(--mp-line)!important;padding:0!important;background:var(--mp-card)!important;
  box-shadow:0 10px 32px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.06)!important;
}
[data-bb-portaled-overlay][data-mp="on"][data-mp-dark]{
  --mp-ink:#ececec;--mp-grey:#8c8c8c;--mp-hover:rgba(255,255,255,.07);--mp-active:rgba(255,255,255,.1);--mp-line:rgba(255,255,255,.12);
  --mp-blue:#6ea3ff;--mp-pill-bg:rgba(255,255,255,.1);--mp-pill-ink:#a8a8a8;--mp-card:#262626;
  box-shadow:0 10px 32px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.3)!important;
}
[data-bb-portaled-overlay][data-mp="on"]>:not([data-mp-root]){display:none!important}
[data-bb-portaled-overlay]:not([data-mp="on"])>[data-mp-root]{display:none!important}
[data-mp-root]{display:block;color:var(--mp-ink);font-size:13px;line-height:20px;font-family:inherit}
.mp{padding:6px;display:flex;flex-direction:column;min-width:0}
.mp *{box-sizing:border-box}
.mp-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;color:var(--mp-grey);border-bottom:1px solid var(--mp-line);margin:0 -6px 4px;padding-inline:14px}
.mp-search input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--mp-ink);font:inherit;font-size:13px;padding:0}
.mp-search input::placeholder{color:var(--mp-grey)}
.mp-list{max-height:min(340px,48vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.mp-group{padding:10px 8px 4px;font-size:12px;line-height:16px;font-weight:500;color:var(--mp-grey);user-select:none}
.mp-group:first-child{padding-top:6px}
.mp-row{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;border-radius:8px;cursor:default;user-select:none;color:var(--mp-ink);position:relative}
.mp-row[data-active],.mp-row:hover{background:var(--mp-hover)}
.mp-row[data-disabled]{opacity:.5;cursor:not-allowed}
.mp-row-plain{padding-left:8px}
.mp-logo{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;background:currentColor;color:var(--mp-ink);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}
.mp-logo-letter{background:none;-webkit-mask:none;mask:none;font-size:11px;font-weight:600;color:var(--mp-grey);border:1px solid var(--mp-line);border-radius:4px;line-height:1}
.mp-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.mp-pill{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:5px;background:var(--mp-pill-bg);color:var(--mp-pill-ink)}
.mp-spacer{flex:1 1 0;min-width:4px}
.mp-runtime{flex:none;font-size:12px;color:var(--mp-grey);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-value{flex:none;color:var(--mp-grey)}
.mp-tick{width:16px;height:16px;flex:none;display:inline-flex}
.mp-check{color:var(--mp-blue)}
.mp-chev{flex:none;color:var(--mp-grey)}
.mp-sep{height:1px;background:var(--mp-line);margin:4px -6px}
.mp-empty{padding:10px 8px;color:var(--mp-grey)}
.mp-anchor{position:relative}
.mp-fly{position:absolute;z-index:5;left:calc(100% + 4px);top:-6px;min-width:200px;width:max-content;max-width:320px;padding:6px;border-radius:12px;background:var(--mp-card);border:1px solid var(--mp-line);box-shadow:0 10px 32px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.06);color:var(--mp-ink)}
.mp-fly[data-wide]{width:320px}
.mp-fly[data-left]{left:auto;right:calc(100% + 4px)}
.mp-fly[data-up]{top:auto;bottom:-6px}
.mp-fly-scroll{max-height:min(320px,50vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.mp-switch{width:28px;height:16px;border-radius:9px;background:var(--mp-pill-bg);position:relative;flex:none;transition:background-color .12s}
.mp-switch>span{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .12s}
.mp-switch[data-on]{background:var(--mp-blue)}
.mp-switch[data-on]>span{transform:translateX(12px)}
@media (prefers-reduced-motion:reduce){.mp-switch,.mp-switch>span{transition:none}}
`;

function ensureStyle(): HTMLStyleElement {
  const existing = document.getElementById("bb-model-picker-style");
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== STYLE) existing.textContent = STYLE;
    return existing;
  }
  const style = document.createElement("style");
  style.id = "bb-model-picker-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
  return style;
}

function isDarkSurface(node: Element): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return false;
  context.fillStyle = "#ffffff";
  context.fillStyle = getComputedStyle(node).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [red = 255, green = 255, blue = 255] = context.getImageData(0, 0, 1, 1).data;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128;
}

function findHandoffButton(dialog: Element): HTMLElement | null {
  for (const button of dialog.querySelectorAll(":scope > :not([data-mp-root]) button")) {
    if (button instanceof HTMLElement && button.textContent?.trim() === "Handoff to new thread") return button;
  }
  return null;
}

function inHandoff(dialog: Element): boolean {
  return dialog.querySelector(':scope > :not([data-mp-root]) [aria-label="Exit handoff"]') !== null;
}

function samePicker(a: PickerProps | null, b: PickerProps | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.selectedProviderId === b.selectedProviderId &&
    a.modelValue === b.modelValue &&
    a.reasoningValue === b.reasoningValue &&
    a.serviceTierValue === b.serviceTierValue &&
    a.modelIsLoading === b.modelIsLoading &&
    a.modelLoadFailed === b.modelLoadFailed &&
    a.hasHandoff === b.hasHandoff &&
    a.providers.length === b.providers.length &&
    a.modelOptions.length === b.modelOptions.length &&
    a.moreModelOptions.length === b.moreModelOptions.length &&
    a.reasoningOptions.length === b.reasoningOptions.length &&
    a.serviceTierOptions.length === b.serviceTierOptions.length &&
    a.agentSections.length === b.agentSections.length &&
    a.agentSections.every((section, index) => section.items.map((item) => item.selected).join() === b.agentSections[index]?.items.map((item) => item.selected).join()) &&
    a.modelOptions.every((option, index) => option.value === b.modelOptions[index]?.value && option.disabled === b.modelOptions[index]?.disabled)
  );
}

class Session {
  private readonly container: HTMLDivElement;
  private readonly root: Root;
  private readonly observer: MutationObserver;
  private last: PickerProps | null = null;
  private frame = 0;
  private gone = false;

  constructor(
    private readonly dialog: HTMLElement,
    private readonly trigger: HTMLElement,
    initial: PickerProps,
  ) {
    this.container = document.createElement("div");
    this.container.setAttribute("data-mp-root", "");
    dialog.appendChild(this.container);
    this.root = createRoot(this.container);
    this.observer = new MutationObserver((records) => {
      if (records.every((record) => this.container.contains(record.target))) return;
      this.schedule();
    });
    this.observer.observe(dialog, { subtree: true, childList: true, attributes: true, characterData: true });
    this.observer.observe(trigger, { subtree: true, childList: true, attributes: true, characterData: true });
    this.apply(initial, true);
  }

  private schedule(): void {
    if (this.frame !== 0 || this.gone) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  refresh(): void {
    if (this.gone) return;
    const live = liveTrigger(this.trigger);
    const next = live === null ? null : findPickerProps(live);
    if (next === null) {
      this.dialog.removeAttribute("data-mp");
      return;
    }
    this.apply(next, false);
  }

  private apply(props: PickerProps, sync: boolean): void {
    const handoff = inHandoff(this.dialog);
    const usable = !props.disabled && !props.modelLoadFailed && !props.modelIsLoading && !handoff && allOptions(props).length > 0;
    if (this.dialog.getAttribute("data-mp") !== (usable ? "on" : "off")) this.dialog.setAttribute("data-mp", usable ? "on" : "off");
    if (usable) {
      const dark = isDarkSurface(document.body);
      if (dark !== this.dialog.hasAttribute("data-mp-dark")) {
        if (dark) this.dialog.setAttribute("data-mp-dark", "");
        else this.dialog.removeAttribute("data-mp-dark");
      }
    }
    if (!sync && samePicker(this.last, props) && !handoff) return;
    this.last = props;
    const view = <View props={props} trigger={this.trigger} onHandoff={() => findHandoffButton(this.dialog)?.click()} />;
    if (sync) flushSync(() => this.root.render(view));
    else this.root.render(view);
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    this.observer.disconnect();
    window.cancelAnimationFrame(this.frame);
    const { root, container } = this;
    window.setTimeout(() => {
      root.unmount();
      container.remove();
    }, 0);
  }
}

export function installModelPicker(): void {
  const previous: unknown = Reflect.get(window, GLOBAL_KEY);
  if (typeof previous === "function") previous();
  const style = ensureStyle();
  const sessions = new Map<Element, Session>();

  const attach = (dialog: Element): void => {
    if (!(dialog instanceof HTMLElement) || sessions.has(dialog) || dialog.querySelector(":scope > [data-mp-root]") !== null) return;
    if (dialog.parentElement?.hasAttribute("data-radix-popper-content-wrapper") !== true) return;
    const trigger = findTrigger(dialog);
    if (trigger === null) return;
    const props = findPickerProps(trigger);
    if (props === null || props.disabled) return;
    try {
      sessions.set(dialog, new Session(dialog, trigger, props));
    } catch {
      dialog.removeAttribute("data-mp");
    }
  };

  const scan = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (node.matches('[role="dialog"][data-bb-portaled-overlay]')) attach(node);
    for (const dialog of node.querySelectorAll('[role="dialog"][data-bb-portaled-overlay]')) attach(dialog);
  };

  const sweep = (): void => {
    for (const [dialog, session] of sessions) {
      if (dialog.isConnected) continue;
      session.dispose();
      sessions.delete(dialog);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) scan(node);
      if (record.removedNodes.length > 0) sweep();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  const prewarm = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest(`button[aria-label^="${TRIGGER_LABEL}"]`);
    if (!(trigger instanceof HTMLElement)) return;
    const props = findPickerProps(trigger);
    if (props !== null) warm(props);
  };
  document.addEventListener("pointerover", prewarm, true);
  document.addEventListener("focusin", prewarm, true);

  Reflect.set(window, GLOBAL_KEY, () => {
    observer.disconnect();
    document.removeEventListener("pointerover", prewarm, true);
    document.removeEventListener("focusin", prewarm, true);
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
    style.remove();
  });
}
