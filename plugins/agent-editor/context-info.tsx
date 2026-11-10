import { experimental_InfoSection as InfoSection, type ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type ReactNode } from "react";

interface ContextEntry {
  id: string;
  label: string;
  tokens: number;
}

interface ContextCategory {
  id: string;
  label: string;
  kind: "used" | "free" | "reserved" | "deferred";
  tokens: number;
  entries: ContextEntry[];
}

interface ContextUsage {
  usedTokens: number | null;
  modelContextWindow: number | null;
  estimated?: boolean;
  cost?: { amount: number; currency: string } | null;
  snapshot?: { categories?: ContextCategory[]; autoCompactAtTokens?: number | null };
}

interface ThreadRecord {
  providerId: string;
  projectId: string;
  environmentId: string | null;
}

interface EnvironmentRecord {
  hostId: string;
  path: string | null;
  branchName: string | null;
}

interface HostRecord {
  id: string;
  name: string;
  status: string;
}

interface ProjectRecord {
  name: string;
}

interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

interface UsageProvider {
  id: string;
  displayName: string;
  accountEmail: string | null;
  planLabel: string | null;
  status: string;
  hint: string | null;
  windows: UsageWindow[];
}

interface UsageResponse {
  ok?: boolean;
  result?: {
    machines?: {
      providers?: {
        id: string;
        displayName: string;
        signInHint?: string;
        usage?: {
          status: string;
          accountEmail?: string | null;
          planLabel?: string | null;
          windows?: UsageWindow[];
          message?: string;
        } | null;
      }[];
    }[];
  };
}

const SWATCH_BLUE = "#3b82f6";
const SWATCH_ORANGE = "#f97316";
const SWATCH_TEAL = "#14b8a6";
const SWATCH_GREY = "#8a8a8a";
const SWATCH_LIGHT = "#c4c4c4";
const SWATCH_FREE = "#ececec";

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return value.toLocaleString("en-US");
}

function trim(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function swatchFor(category: ContextCategory): string {
  if (category.kind === "free") return SWATCH_FREE;
  if (category.kind === "reserved" || category.kind === "deferred") return SWATCH_LIGHT;
  const label = category.label.toLowerCase();
  if (label.includes("message") || label.includes("conversation")) return SWATCH_BLUE;
  if (label.includes("mcp")) return SWATCH_ORANGE;
  if (label.includes("system tool") || label.includes("tool definition")) return SWATCH_TEAL;
  return SWATCH_GREY;
}

function usePolled<T>(url: string | null, intervalMs: number, init?: RequestInit): T | null {
  const [value, setValue] = useState<T | null>(null);
  const body = init?.body;
  useEffect(() => {
    if (url === null) return;
    let live = true;
    const read = () => {
      void fetch(url, { credentials: "same-origin", ...init })
        .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
        .then((next) => {
          if (live && next !== null) setValue(next);
        })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, intervalMs);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [url, intervalMs, body]);
  return value;
}

function shortPath(path: string | null): string {
  if (path === null) return "";
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted-foreground">
      {children}
    </svg>
  );
}

function EnvRow({ icon, label, detail, trailing }: { icon: ReactNode; label: string; detail?: string; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 px-1 text-sm text-foreground">
      <RowIcon>{icon}</RowIcon>
      <span className="min-w-0 truncate">
        {label}
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{trailing}</span>
    </div>
  );
}

export function EnvironmentInfoSection({ threadId }: ExperimentalThreadInfoProps) {
  const thread = usePolled<ThreadRecord>(`/api/v1/threads/${encodeURIComponent(threadId)}`, 30_000);
  const environment = usePolled<EnvironmentRecord>(thread?.environmentId ? `/api/v1/environments/${encodeURIComponent(thread.environmentId)}` : null, 30_000);
  const project = usePolled<ProjectRecord>(thread ? `/api/v1/projects/${encodeURIComponent(thread.projectId)}` : null, 60_000);
  const hosts = usePolled<HostRecord[]>("/api/v1/hosts", 15_000);
  if (!thread) return null;
  const host = hosts?.find((entry) => entry.id === environment?.hostId) ?? null;
  const connected = host?.status === "connected";
  return (
    <InfoSection label="Environment">
      <div className="pb-2">
        <EnvRow
          icon={<><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2.5 19h19" /></>}
          label={host ? host.name.replace(/\.(lan|local)$/i, "") : "This computer"}
          trailing={host ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: connected ? "#22c55e" : SWATCH_LIGHT }} />
              {connected ? "Connected" : host.status}
            </span>
          ) : null}
        />
        <EnvRow
          icon={<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}
          label={project?.name ?? "Project"}
          detail={shortPath(environment?.path ?? null) || undefined}
        />
        {environment?.branchName ? (
          <EnvRow icon={<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 8v8M18 10c0 4-6 3-12 6" /></>} label={environment.branchName} />
        ) : null}
        <EnvRow
          icon={<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 10l2 2-2 2M13 14h3" /></>}
          label={thread.providerId}
        />
      </div>
    </InfoSection>
  );
}

function Row({
  swatch,
  label,
  tokens,
  percent,
  muted,
  chevron,
  open,
  onClick,
}: {
  swatch?: string;
  label: string;
  tokens?: string;
  percent?: string;
  muted?: boolean;
  chevron?: boolean;
  open?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      {swatch ? <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: swatch }} /> : <span aria-hidden className="size-2.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {tokens ? <span className="shrink-0 tabular-nums">{tokens}</span> : null}
      <span className="w-11 shrink-0 text-right tabular-nums">{percent ?? ""}</span>
      <span aria-hidden className={`w-3 shrink-0 text-center ${open ? "rotate-90" : ""}`}>{chevron ? "›" : ""}</span>
    </>
  );
  const tone = muted ? "text-muted-foreground" : "text-foreground";
  if (onClick) {
    return (
      <button type="button" aria-expanded={open} onClick={onClick} className={`flex w-full items-center gap-2.5 py-1 text-xs ${tone}`}>
        {content}
      </button>
    );
  }
  return <div className={`flex w-full items-center gap-2.5 py-1 text-xs ${tone}`}>{content}</div>;
}

function ExpandableGroup({ category }: { category: ContextCategory }) {
  const [open, setOpen] = useState(false);
  const label = category.label.replace(/\s*\(deferred\)$/i, "");
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2.5 py-1 text-left text-xs text-foreground">
        <span aria-hidden className={`w-2.5 shrink-0 text-center text-muted-foreground ${open ? "rotate-90" : ""}`}>›</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{category.entries.length}</span>
      </button>
      {open ? (
        <div className="space-y-1 pb-1 pl-5 text-xs text-muted-foreground">
          {category.entries.map((entry) => (
            <div key={entry.id} className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 break-words">{entry.label}</span>
              <span className="shrink-0 tabular-nums">{formatTokens(entry.tokens)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function percentOf(tokens: number, capacity: number): string {
  return capacity > 0 ? `${((tokens / capacity) * 100).toFixed(1)}%` : "";
}

interface EstimateResponse {
  ok?: boolean;
  result?: { categories: ContextCategory[]; note: string };
}

export function ContextInfoSection({ threadId }: ExperimentalThreadInfoProps) {
  const body = usePolled<{ usage?: ContextUsage | null }>(`/api/v1/threads/${encodeURIComponent(threadId)}/context`, 5000);
  const thread = usePolled<ThreadRecord>(`/api/v1/threads/${encodeURIComponent(threadId)}`, 60_000);
  const environment = usePolled<EnvironmentRecord>(thread?.environmentId ? `/api/v1/environments/${encodeURIComponent(thread.environmentId)}` : null, 60_000);
  const usage = body?.usage ?? null;
  const capacity = usage?.modelContextWindow ?? 0;
  const used = usage?.usedTokens ?? 0;
  const native = (usage?.snapshot?.categories?.length ?? 0) > 0;
  const estimateWanted = usage !== null && capacity > 0 && !native && thread !== null;
  const estimateResponse = usePolled<EstimateResponse>(
    estimateWanted ? "/api/v1/plugins/boltrig-agent-editor/rpc/estimateContext" : null,
    30_000,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: environment?.path ?? null, usedTokens: used, windowTokens: capacity }),
    },
  );
  if (!usage || capacity <= 0) return null;
  const percent = Math.max(0, Math.min(100, Math.round((used / capacity) * 100)));
  const estimate = !native && estimateResponse?.ok === true ? estimateResponse.result ?? null : null;
  const categories = native ? usage.snapshot?.categories ?? [] : estimate?.categories ?? [];
  const approximate = estimate !== null;
  const detailed = categories.length > 0;
  const usedCategories = categories.filter((category) => category.kind === "used");
  const free = categories.find((category) => category.kind === "free");
  const freeTokens = free?.tokens ?? Math.max(0, capacity - used);
  const reserved = categories.filter((category) => category.kind === "reserved");
  const deferred = categories.filter((category) => category.kind === "deferred");
  const expandable = categories.filter((category) => category.entries.length > 0);
  const segments = detailed
    ? usedCategories.map((category) => ({ key: category.id, tokens: category.tokens, color: swatchFor(category) }))
    : [{ key: "messages", tokens: used, color: SWATCH_BLUE }];
  const prefix = usage.estimated === true ? "~" : "";
  return (
    <InfoSection label="Context">
      <div className="px-1 pb-2">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-sm font-medium text-foreground">{prefix}{percent}% used</span>
          <span className="tabular-nums text-muted-foreground">{prefix}{formatTokens(used)} / {formatTokens(capacity)}</span>
        </div>
        <div className="mb-3 flex h-1.5 overflow-hidden rounded-full" style={{ background: SWATCH_FREE }}>
          {segments.map((segment) => (
            <span key={segment.key} style={{ width: `${Math.min(100, (segment.tokens / capacity) * 100)}%`, background: segment.color }} />
          ))}
        </div>
        {detailed ? (
          usedCategories.map((category) => (
            <Row key={category.id} swatch={swatchFor(category)} label={category.label} tokens={`${approximate ? "~" : ""}${formatTokens(category.tokens)}`} percent={percentOf(category.tokens, capacity)} />
          ))
        ) : (
          <Row swatch={SWATCH_BLUE} label="Messages" tokens={formatTokens(used)} percent={percentOf(used, capacity)} />
        )}
        {reserved.map((category) => (
          <Row key={category.id} swatch={SWATCH_LIGHT} label={category.label} tokens={formatTokens(category.tokens)} percent={percentOf(category.tokens, capacity)} muted />
        ))}
        <Row swatch={SWATCH_FREE} label="Free space" tokens={formatTokens(freeTokens)} percent={percentOf(freeTokens, capacity)} muted />
        {deferred.length > 0 ? (
          <div className="mt-2">
            {deferred.map((category) => (
              <Row key={category.id} swatch={SWATCH_LIGHT} label={category.label} tokens={formatTokens(category.tokens)} percent="—" muted />
            ))}
          </div>
        ) : null}
        {expandable.length > 0 ? (
          <div className="mt-2">
            {expandable.map((category) => (
              <ExpandableGroup key={category.id} category={category} />
            ))}
          </div>
        ) : null}
        {approximate && estimate ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{estimate.note}</p>
        ) : null}
        {!detailed ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">This provider reports total usage only, so the breakdown is not available.</p>
        ) : null}
        {usage.cost ? (
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Cost</span>
            <span className="tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: usage.cost.currency, maximumFractionDigits: 4 }).format(usage.cost.amount)}</span>
          </div>
        ) : null}
      </div>
    </InfoSection>
  );
}

function resetText(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Resets at ${time}`;
  return `Resets ${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

function toProviders(response: UsageResponse | null): UsageProvider[] {
  const providers: UsageProvider[] = [];
  for (const machine of response?.result?.machines ?? []) {
    for (const provider of machine.providers ?? []) {
      const usage = provider.usage;
      if (!usage || usage.status === "not_installed") continue;
      providers.push({
        id: provider.id,
        displayName: provider.displayName,
        accountEmail: usage.accountEmail ?? null,
        planLabel: usage.planLabel ?? null,
        status: usage.status,
        hint: usage.status === "ok" ? null : (usage.message ?? provider.signInHint ?? null),
        windows: usage.windows ?? [],
      });
    }
  }
  return providers;
}

export function UsageInfoSection(_props: ExperimentalThreadInfoProps) {
  const response = usePolled<UsageResponse>("/api/v1/plugins/bb--provider-usage/rpc/getUsage", 60_000, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ force: false, machineIds: null, providerIds: [], maxAgeMs: 120_000 }),
  });
  const providers = toProviders(response);
  if (providers.length === 0) return null;
  return (
    <InfoSection label="Usage">
      <div className="space-y-3 px-1 pb-2">
        {providers.map((provider) => (
          <div key={provider.id}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{provider.displayName}</span>
              <span className="truncate text-muted-foreground">{[provider.planLabel, provider.accountEmail].filter(Boolean).join(" · ")}</span>
            </div>
            {provider.status === "ok" ? (
              provider.windows.length > 0 ? (
                provider.windows.map((window) => {
                  const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
                  return (
                    <div key={window.label} className="py-1">
                      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                        <span className="truncate">{window.label.replace(" · ", " - ")}</span>
                        <span className="shrink-0 tabular-nums">{percent}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: SWATCH_FREE }}>
                        <span className="block h-full" style={{ width: `${percent}%`, background: percent >= 90 ? "var(--destructive)" : "var(--foreground)" }} />
                      </div>
                      {window.resetsAt ? <div className="mt-0.5 text-xs text-muted-foreground">{resetText(window.resetsAt)}</div> : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">No usage limits reported.</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">{provider.hint ?? "Usage unavailable."}</p>
            )}
          </div>
        ))}
      </div>
    </InfoSection>
  );
}
