import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_InfoList as InfoList,
  experimental_InfoListRow as InfoListRow,
  experimental_InfoSection as InfoSection,
  experimental_THREAD_INFO_SECTION_GROUPS,
  useBbContext,
  useBbNavigate,
  useRpc,
  type ExperimentalThreadInfoProps,
  type PluginNavPanelProps,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import {
  STATE_GROUPS,
  ageLabel,
  dayLabel,
  duePhrase,
  groupIssues,
  isOverdue,
  matchesQuery,
  openWork,
  sidebarProjects,
  type IssueGroup,
  type IssueOrder,
  type LinearChange,
  type LinearChild,
  type LinearComment,
  type LinearLink,
  type LinearParent,
  type LinearDirectory,
  type LinearRecord,
  type LinearWorkflowState,
  type LinearDirectoryTeam,
  type LinearIssueRow,
} from "./cards.js";
import { parseDescription, type Inline } from "./prose.js";
import { linearRpc } from "./server.js";
import { Note, Page, Panel, Primary, Quiet } from "./chrome.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function LinearLogo({ className, color }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className ?? "size-3.5 shrink-0"} fill={color ?? "currentColor"}>
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

function StateIcon({ state, className }: { state: LinearIssueRow["state"]; className?: string }) {
  const { type, color } = state;
  const ring = type === "backlog"
    ? <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.4 1.6" />
    : <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />;
  let inner = null;
  if (type === "started") inner = <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill={color} />;
  if (type === "completed" || type === "canceled") {
    inner = (
      <>
        <circle cx="7" cy="7" r="6.25" fill={color} />
        <path
          d={type === "completed" ? "M4.3 7.2 6.1 9l3.6-3.8" : "M4.8 4.8l4.4 4.4M9.2 4.8 4.8 9.2"}
          fill="none"
          stroke="var(--background, #fff)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className={className ?? "size-3.5 shrink-0"} role="img" aria-label={state.name}>
      <title>{state.name}</title>
      {type === "completed" || type === "canceled" ? null : ring}
      {inner}
    </svg>
  );
}

const ACCENT = "#5E6AD2";

function priorityInk(priority: number): { color: string; bars: number } | null {
  if (priority === 1) return { color: "#EB5757", bars: 3 };
  if (priority === 2) return { color: "#F2994A", bars: 3 };
  if (priority === 3) return { color: "#F2C94C", bars: 2 };
  if (priority === 4) return { color: "#95999F", bars: 1 };
  return null;
}

function PriorityMark({ priority, label }: { priority: number; label: string }) {
  const ink = priorityInk(priority);
  if (!ink) return null;
  return (
    <span className="inline-flex items-end gap-px" title={label || "Priority"} aria-label={label || "Priority"}>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className="w-0.5 rounded-sm"
          style={{ height: 3 + bar * 2, backgroundColor: ink.color, opacity: bar <= ink.bars ? 1 : 0.28 }}
        />
      ))}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`;
  return letters.toUpperCase();
}

function tint(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "rgba(149,153,159,0.16)";
  const value = Number.parseInt(full, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},0.16)`;
}

function AssigneeMark({ name }: { name: string }) {
  return (
    <span
      title={name}
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium leading-none"
      style={{ background: "rgba(94,106,210,0.16)", color: ACCENT }}
    >
      {initials(name)}
    </span>
  );
}

function LabelPill({ name, color, extra }: { name: string; color: string; extra?: number }) {
  return (
    <span className="inline-flex h-5 max-w-28 shrink-0 items-center gap-1 rounded-full px-1.5 text-[12px]" style={{ background: tint(color) }} title={name}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
      {extra ? <span className="shrink-0 text-muted-foreground">+{extra}</span> : null}
    </span>
  );
}

const PRIORITIES = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
] as const;

const SORTS: Array<{ value: IssueOrder; label: string }> = [
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "due", label: "Due date" },
  { value: "title", label: "Title" },
];

function InlineRun({ items, onOpenIssue }: { items: Inline[]; onOpenIssue?: (identifier: string) => void }) {
  return items.map((item, index) => {
    if (item.kind === "strong") return <strong key={index}>{item.text}</strong>;
    if (item.kind === "em") return <em key={index}>{item.text}</em>;
    if (item.kind === "code") return <code key={index} className="rounded-sm bg-muted px-1 text-[12px]">{item.text}</code>;
    if (item.kind === "link") return <a key={index} className="hover:underline" style={{ color: ACCENT }} href={item.href} target="_blank" rel="noreferrer">{item.text}</a>;
    if (item.kind === "issue") {
      return (
        <button key={index} type="button" className="hover:underline" style={{ color: ACCENT }} onClick={() => onOpenIssue?.(item.identifier)}>
          {item.identifier}
        </button>
      );
    }
    if (item.kind === "check") {
      return (
        <span
          key={index}
          role="img"
          aria-label={item.checked ? "Checked" : "Unchecked"}
          className="mr-1.5 inline-flex size-3.5 items-center justify-center rounded-sm border align-[-2px] text-[10px] leading-none"
          style={item.checked ? { borderColor: ACCENT, background: ACCENT, color: "#fff" } : { borderColor: "currentColor", opacity: 0.45 }}
        >
          {item.checked ? "✓" : ""}
        </span>
      );
    }
    return <span key={index}>{item.text}</span>;
  });
}

function Description({ text, className, onOpenIssue }: { text: string; className?: string; onOpenIssue?: (identifier: string) => void }) {
  return (
    <div className={className ?? "flex flex-col gap-4 text-[15px] leading-7"}>
      {parseDescription(text).map((block, index) => {
        if (block.kind === "h") return <h3 key={index} className="mt-3 text-[13px] font-medium first:mt-0"><InlineRun items={block.inlines} onOpenIssue={onOpenIssue} /></h3>;
        if (block.kind === "ul" || block.kind === "ol") {
          const tasks = block.items.some((item) => item[0]?.kind === "check");
          const List = block.kind === "ul" ? "ul" : "ol";
          return (
            <List key={index} className={tasks ? "flex flex-col gap-1" : block.kind === "ul" ? "list-disc space-y-1 pl-4 marker:text-muted-foreground" : "list-decimal space-y-1 pl-4 marker:text-muted-foreground"}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineRun items={item} onOpenIssue={onOpenIssue} /></li>)}
            </List>
          );
        }
        return <p key={index}><InlineRun items={block.inlines} onOpenIssue={onOpenIssue} /></p>;
      })}
    </div>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="relative flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">{children}</div>
    </div>
  );
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("copy failed");
  }
}

function IssueSheet({
  card,
  comments,
  history,
  parent,
  children,
  links,
  states,
  members,
  pending,
  onComment,
  onStatus,
  onPriority,
  onAssignee,
  onLoadMembers,
  onOpenIssue,
  onOpenProject,
  onOpenTeam,
}: {
  card: LinearIssueRow;
  comments: LinearComment[];
  history: LinearChange[];
  parent: LinearParent | null;
  children: LinearChild[];
  links: LinearLink[];
  states: LinearWorkflowState[];
  members: Array<{ id: string; name: string }>;
  pending: boolean;
  onComment: (body: string) => Promise<void>;
  onStatus: (stateId: string) => Promise<void>;
  onPriority: (priority: number) => Promise<void>;
  onAssignee: (assigneeId: string | null) => Promise<void>;
  onLoadMembers: () => Promise<void>;
  onOpenIssue: (identifier: string) => void;
  onOpenProject: (name: string) => void;
  onOpenTeam: (key: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [propertyMenu, setPropertyMenu] = useState<"" | "status" | "priority" | "assignee">("");
  const propertiesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!propertyMenu) return;
    function close(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && propertiesRef.current?.contains(target)) return;
      setPropertyMenu("");
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPropertyMenu("");
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [propertyMenu]);
  const activity = [
    ...history.map((change) => ({ kind: "change" as const, ...change })),
    ...comments.map((comment) => ({ kind: "comment" as const, ...comment })),
  ].sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""));
  const statusId = states.some((state) => state.id === card.state.id) ? card.state.id : "";
  const properties = (
    <>
      <Property label="Status">
        <button
          type="button"
          aria-label="Status"
          aria-expanded={propertyMenu === "status"}
          disabled={states.length === 0}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPropertyMenu((current) => current === "status" ? "" : "status");
          }}
          className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-state-hover disabled:hover:bg-transparent"
        >
          <StateIcon state={card.state} className="size-3.5" />
          <span className="truncate">{card.state.name}</span>
        </button>
        {propertyMenu === "status" ? (
          <div
            onMouseDown={(event) => event.stopPropagation()}
            className="absolute top-8 left-0 z-20 max-h-64 w-44 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
          >
            {states.map((state) => (
              <button
                key={state.id}
                type="button"
                onClick={() => {
                  setPropertyMenu("");
                  if (!state.id || state.id === statusId) return;
                  setActionError(null);
                  void onStatus(state.id).catch((caught: unknown) => setActionError(message(caught)));
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
                style={state.id === statusId ? { background: "rgba(94,106,210,0.12)" } : undefined}
              >
                <StateIcon state={{ ...state, id: state.id }} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{state.name}</span>
                {state.id === statusId ? <span style={{ color: ACCENT }}>✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </Property>
      <Property label="Priority">
        <button
          type="button"
          aria-label="Priority"
          aria-expanded={propertyMenu === "priority"}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPropertyMenu((current) => current === "priority" ? "" : "priority");
          }}
          className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-state-hover"
        >
          <PriorityMark priority={card.priority} label={card.priorityLabel} />
          <span className="truncate">{card.priorityLabel || "No priority"}</span>
        </button>
        {propertyMenu === "priority" ? (
          <div
            onMouseDown={(event) => event.stopPropagation()}
            className="absolute top-8 left-0 z-20 w-40 rounded-md border border-border bg-background p-1 shadow-lg"
          >
            {PRIORITIES.map((priority) => (
              <button
                key={priority.value}
                type="button"
                onClick={() => {
                  setPropertyMenu("");
                  if (priority.value === card.priority) return;
                  setActionError(null);
                  void onPriority(priority.value).catch((caught: unknown) => setActionError(message(caught)));
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
                style={priority.value === card.priority ? { background: "rgba(94,106,210,0.12)" } : undefined}
              >
                <PriorityMark priority={priority.value} label={priority.label} />
                <span className="min-w-0 flex-1 truncate">{priority.label}</span>
                {priority.value === card.priority ? <span style={{ color: ACCENT }}>✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </Property>
      <Property label="Assignee">
        <button
          type="button"
          aria-label="Assignee"
          aria-expanded={propertyMenu === "assignee"}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPropertyMenu((current) => current === "assignee" ? "" : "assignee");
            if (members.length === 0) void onLoadMembers().catch((caught: unknown) => setActionError(message(caught)));
          }}
          className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-state-hover"
        >
          {card.assignee ? <AssigneeMark name={card.assignee} /> : <span aria-hidden className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/40" />}
          <span className="truncate">{card.assignee || "Unassigned"}</span>
        </button>
        {propertyMenu === "assignee" ? (
          <div
            onMouseDown={(event) => event.stopPropagation()}
            className="absolute top-8 left-0 z-20 max-h-64 w-52 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
          >
            {[{ id: "", name: "Unassigned" }, ...members].map((member) => {
              const selected = member.id === card.assigneeId;
              return (
                <button
                  key={member.id || "none"}
                  type="button"
                  onClick={() => {
                    setPropertyMenu("");
                    if (selected) return;
                    setActionError(null);
                    void onAssignee(member.id || null).catch((caught: unknown) => setActionError(message(caught)));
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
                  style={selected ? { background: "rgba(94,106,210,0.12)" } : undefined}
                >
                  {member.id ? <AssigneeMark name={member.name} /> : <span aria-hidden className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/40" />}
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  {selected ? <span style={{ color: ACCENT }}>✓</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </Property>
      <Property label="Milestone">
        <MilestoneMark />
        {card.milestone ? <span className="truncate">{card.milestone}</span> : <span className="text-muted-foreground">No milestone</span>}
      </Property>
      <Property label="Estimate">
        {card.estimate === null ? <span className="text-muted-foreground">No estimate</span> : <span className="tabular-nums">{card.estimate}</span>}
      </Property>
      <Property label="Project">
        {card.project ? (
          <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:underline" style={{ color: ACCENT }} onClick={() => onOpenProject(card.project ?? "")}>
            <EntityMark icon={card.projectIcon} color={card.projectColor || "#8A8F98"} name={card.project} />
            <span className="truncate">{card.project}</span>
          </button>
        ) : <span className="text-muted-foreground">No project</span>}
      </Property>
      <Property label="Due">
        <CalendarMark />
        {card.dueDate ? <span style={isOverdue(card.dueDate, card.state.type) ? { color: "#EB5757" } : undefined}>{duePhrase(card.dueDate)}</span> : <span className="text-muted-foreground">No due date</span>}
      </Property>
      <Property label="Created">{card.createdAt ? dayLabel(card.createdAt) : <span className="text-muted-foreground">Unknown</span>}</Property>
      <Property label="Labels">
        {card.labels.length === 0 ? <span className="text-muted-foreground">No labels</span> : card.labels.map((label) => <LabelPill key={label.name} name={label.name} color={label.color} />)}
      </Property>
    </>
  );
  return (
    <div className="@container grid grid-cols-1 items-start gap-6 @[48rem]:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)] @[48rem]:gap-10">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {card.team ? (
            <>
              <button type="button" className="flex items-center gap-1.5 hover:text-foreground" onClick={() => onOpenTeam(card.team?.key ?? "")}>
                <EntityMark icon="" color={card.team.color || "#5E6AD2"} name={card.team.name} />
                {card.team.name}
              </button>
              <span aria-hidden>/</span>
            </>
          ) : null}
          <button
            type="button"
            aria-label="Copy identifier"
            className="text-[12px] tabular-nums text-muted-foreground hover:text-foreground"
            onClick={() => {
              const show = (text: string) => {
                setNotice(text);
                window.setTimeout(() => setNotice(""), 1200);
              };
              void copyText(card.identifier).then(() => show("Copied")).catch(() => show("Not copied"));
            }}
          >
            {notice || card.identifier}
          </button>
          {card.url ? (
            <a className="ml-auto text-[12px] hover:underline" style={{ color: ACCENT }} href={card.url} target="_blank" rel="noreferrer">Open in Linear</a>
          ) : null}
        </div>
        {parent ? (
          <button type="button" className="flex h-8 max-w-full items-center gap-2 self-start rounded-md px-1 text-left hover:bg-state-hover" onClick={() => onOpenIssue(parent.identifier)}>
            <StateIcon state={{ id: "", ...parent.state }} className="size-3.5" />
            <span className="w-[4.5rem] shrink-0 text-[12px] tabular-nums text-muted-foreground">{parent.identifier}</span>
            <span className="min-w-0 truncate text-[13px]">{parent.title}</span>
          </button>
        ) : null}
        <h2 className="text-[22px] font-medium leading-tight tracking-tight @[48rem]:text-[28px]">{card.title}</h2>
      </div>
      <aside className="flex min-w-0 flex-col gap-4 @[48rem]:sticky @[48rem]:top-0 @[48rem]:col-start-2 @[48rem]:row-span-2 @[48rem]:row-start-1">
        {children.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <h3 className="text-[12px] text-muted-foreground">Sub-issues</h3>
            <ScopeGraph parts={children.map((child) => child.state)} />
          </div>
        )}
        <div ref={propertiesRef} className="grid grid-cols-2 gap-x-4 @[48rem]:grid-cols-1">{properties}</div>
      </aside>
      <div className="flex min-w-0 flex-col gap-4">
        {pending
          ? <p className="text-[12px] text-muted-foreground">Loading description…</p>
          : card.description.trim()
            ? <Description text={card.description} onOpenIssue={onOpenIssue} />
            : <p className="text-[13px] italic text-muted-foreground">No description.</p>}
        {pending || children.length === 0 ? null : (
          <section className="flex flex-col gap-1">
            <h3 className="text-[13px] font-medium">Sub-issues</h3>
            {children.map((child) => (
              <button key={child.id} type="button" onClick={() => onOpenIssue(child.identifier)} className="flex h-9 items-center gap-2 rounded-md px-1 text-left hover:bg-state-hover">
                <StateIcon state={{ id: "", ...child.state }} className="size-3.5" />
                <span className="w-[4.5rem] shrink-0 text-[12px] tabular-nums text-muted-foreground">{child.identifier}</span>
                <span className="min-w-0 truncate text-[13px]">{child.title}</span>
              </button>
            ))}
          </section>
        )}
        {pending || links.length === 0 ? null : (
          <section className="flex flex-col gap-1">
            <h3 className="text-[13px] font-medium">Relations</h3>
            {links.map((link) => (
              <button key={link.id} type="button" onClick={() => onOpenIssue(link.identifier)} className="flex h-9 items-center gap-2 rounded-md px-1 text-left hover:bg-state-hover">
                <span className="w-24 shrink-0 text-[12px] text-muted-foreground">{link.label}</span>
                <StateIcon state={{ id: "", ...link.state }} className="size-3.5" />
                <span className="w-[4.5rem] shrink-0 text-[12px] tabular-nums text-muted-foreground">{link.identifier}</span>
                <span className="min-w-0 truncate text-[13px]">{link.title}</span>
              </button>
            ))}
          </section>
        )}
        {pending ? null : (
          <section className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
            <h3 className="text-[13px] font-medium">Activity</h3>
            {activity.length === 0 ? <p className="text-[13px] text-muted-foreground">No activity yet.</p> : (
              <div className="relative flex flex-col gap-4">
                <span aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />
                {activity.map((item) => item.kind === "change" ? (
                  <p key={item.id} className="relative pl-6 text-[13px] leading-6 text-muted-foreground">
                    <span aria-hidden className="absolute top-[9px] left-[4px] size-1.5 rounded-full bg-muted-foreground/70 ring-4 ring-background" />
                    <span className="text-foreground">{item.author || "Linear"}</span> {item.text}
                    {item.createdAt ? <span className="ml-2 tabular-nums">{ageLabel(item.createdAt)}</span> : null}
                  </p>
                ) : (
                  <article key={item.id} className="relative flex flex-col gap-1.5 pl-6">
                    <span className="absolute top-0 left-0 bg-background">
                      <AssigneeMark name={item.author || "Linear"} />
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{item.author || "Linear"}</span>
                      <span className="text-[12px] tabular-nums text-muted-foreground">{item.createdAt ? ageLabel(item.createdAt) : ""}</span>
                    </div>
                    {item.body.trim() ? <Description text={item.body} className="flex flex-col gap-2 text-[13px] leading-6" onOpenIssue={onOpenIssue} /> : null}
                  </article>
                ))}
              </div>
            )}
            <form
              className="rounded-lg border border-border focus-within:border-foreground/30"
              onSubmit={(event) => {
                event.preventDefault();
                const body = draft.trim();
                if (!body || sending) return;
                setSending(true);
                setActionError(null);
                void onComment(body).then(() => setDraft("")).catch((caught: unknown) => setActionError(message(caught))).finally(() => setSending(false));
              }}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Leave a comment…"
                aria-label="Leave a comment"
                rows={3}
                className="w-full resize-y bg-transparent px-3 py-2 text-[13px] leading-6 outline-none"
              />
              <div className="flex items-center justify-end px-2 pb-2">
                <button type="submit" disabled={!draft.trim() || sending} className="h-7 rounded-md px-2.5 text-[12px] text-white disabled:opacity-40" style={{ background: ACCENT }}>
                  {sending ? "Sending" : "Comment"}
                </button>
              </div>
              {actionError ? <p className="px-3 pb-2 text-[13px] text-destructive">{actionError}</p> : null}
            </form>
          </section>
        )}
      </div>
    </div>
  );
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function panelRoute(subPath: string): { issue: string; project: string | null; team: string | null; initiative: string | null } {
  const parts = subPath.split("/").filter(Boolean).map(decodeSegment);
  if (parts[0] === "project") return { issue: "", project: parts[1] ?? "", team: null, initiative: null };
  if (parts[0] === "team") return { issue: "", project: null, team: parts[1] ?? "", initiative: null };
  if (parts[0] === "initiative") return { issue: "", project: null, team: null, initiative: parts[1] ?? "" };
  return { issue: parts[0] ?? "", project: null, team: null, initiative: null };
}

function LinearBoard({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof linearRpc>();
  const navigate = useBbNavigate();
  const { threadId } = useBbContext();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [issues, setIssues] = useState<LinearIssueRow[] | null>(null);
  const [heading, setHeading] = useState({ title: "Linear", detail: "" });
  const [includeDone, setIncludeDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [teamKey, setTeamKey] = useState<string | null>(null);
  const [initiativeId, setInitiativeId] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [card, setCard] = useState<LinearIssueRow | null>(null);
  const [comments, setComments] = useState<LinearComment[]>([]);
  const [history, setHistory] = useState<LinearChange[]>([]);
  const [parentIssue, setParentIssue] = useState<LinearParent | null>(null);
  const [children, setChildren] = useState<LinearChild[]>([]);
  const [links, setLinks] = useState<LinearLink[]>([]);
  const [person, setPerson] = useState("");
  const [order, setOrder] = useState<IssueOrder>("priority");
  const [groupBy, setGroupBy] = useState<IssueGroup>("status");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [menu, setMenu] = useState<"" | "filter" | "sort" | "display">("");
  const [filterField, setFilterField] = useState<"" | "status" | "priority" | "assignee" | "project" | "label">("");
  const [filterQuery, setFilterQuery] = useState("");
  const [record, setRecord] = useState<LinearRecord | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [states, setStates] = useState<LinearWorkflowState[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [teamMenu, setTeamMenu] = useState(false);
  const [priorityMenu, setPriorityMenu] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState(0);
  const [newTeamId, setNewTeamId] = useState("");
  const [newTeams, setNewTeams] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const request = useRef(0);
  const routed = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProject(null);
  }, [threadId]);

  useEffect(() => {
    let live = true;
    void rpc.call("status", null).then(async (status) => {
      if (!live) return;
      setConnected(status.connected);
      if (!status.connected) return;
      const board = await rpc.call("board", { threadId, includeDone, teamKey, initiativeId });
      if (!live) return;
      setHeading({ title: board.title, detail: board.detail });
      setIssues(board.issues);
      setError(board.scope === "unmatched" ? board.detail : null);
    }).catch((caught: unknown) => {
      if (live) setError(message(caught));
    });
    return () => { live = false; };
  }, [rpc, threadId, includeDone, teamKey, initiativeId]);

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: MouseEvent) {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) return;
      setMenu("");
      setFilterField("");
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [menu]);

  useEffect(() => {
    if (!project && !initiativeId) {
      setRecord(null);
      setRecordError(null);
      setOpenDoc(null);
      return;
    }
    let live = true;
    setRecord(null);
    setRecordError(null);
    setOpenDoc(null);
    const call = project
      ? rpc.call("record", { project, initiativeId: null })
      : rpc.call("record", { project: null, initiativeId });
    void call.then((result) => {
      if (live) setRecord(result);
    }).catch((caught: unknown) => {
      if (live) setRecordError(message(caught));
    });
    return () => { live = false; };
  }, [rpc, project, initiativeId]);

  const projects = useMemo(() => {
    const names = new Set<string>();
    for (const issue of issues ?? []) if (issue.project) names.add(issue.project);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const people = useMemo(() => {
    const names = new Set<string>();
    for (const issue of issues ?? []) if (issue.assignee) names.add(issue.assignee);
    if (person && person !== "__none__") names.add(person);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [issues, person]);

  const labels = useMemo(() => {
    const names = new Set<string>();
    for (const issue of issues ?? []) for (const label of issue.labels) names.add(label.name);
    if (labelFilter) names.add(labelFilter);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [issues, labelFilter]);

  const visible = useMemo(() => {
    return (issues ?? []).filter((issue) => {
      if (project && issue.project !== project) return false;
      if (person === "__none__" && issue.assignee) return false;
      if (person && person !== "__none__" && issue.assignee !== person) return false;
      if (priorityFilter && String(issue.priority) !== priorityFilter) return false;
      if (statusFilter && issue.state.type !== statusFilter) return false;
      if (labelFilter && !issue.labels.some((label) => label.name === labelFilter)) return false;
      return matchesQuery(issue, query);
    });
  }, [issues, project, person, priorityFilter, statusFilter, labelFilter, query]);

  const buckets = useMemo(() => groupIssues(visible, groupBy, order), [visible, groupBy, order]);

  const ordered = useMemo(() => {
    return buckets.filter((bucket) => !folded.has(bucket.id)).flatMap((bucket) => bucket.rows);
  }, [buckets, folded]);

  useEffect(() => {
    const route = panelRoute(subPath);
    if (route.team !== null) {
      setTeamKey(route.team || null);
      setInitiativeId(null);
      setProject(null);
    } else if (route.initiative !== null) {
      setInitiativeId(route.initiative || null);
      setTeamKey(null);
      setProject(null);
    } else if (route.project !== null) {
      setTeamKey(null);
      setInitiativeId(null);
      setProject(route.project || null);
      routed.current = "";
      return;
    } else if (!route.issue) {
      setTeamKey(null);
      setInitiativeId(null);
    }
    const identifier = route.issue;
    if (!identifier || !issues || routed.current === identifier) return;
    routed.current = identifier;
    const match = issues.find((issue) => issue.identifier === identifier);
    void open(match ?? {
      id: identifier,
      identifier,
      title: identifier,
      url: "",
      description: "",
      priority: 0,
      priorityLabel: "",
      state: { id: "", name: "Unknown", type: "unstarted", color: "#bec2c8" },
      project: null,
      projectIcon: "",
      projectColor: "",
      assignee: null,
      assigneeId: "",
      labels: [],
      createdAt: "",
      updatedAt: "",
      dueDate: "",
      milestone: "",
      estimate: null,
      team: null,
    }, true);
  }, [subPath, issues]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.key === "Escape" && target === searchRef.current) {
        event.preventDefault();
        if (query) setQuery("");
        else searchRef.current?.blur();
        return;
      }
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((event.key === "c" || event.key === "C") && !event.metaKey && !event.ctrlKey && !event.altKey && !panelRoute(subPath).issue) {
        event.preventDefault();
        setCreating(true);
        setTeamMenu(false);
        setPriorityMenu(false);
        setCreateError(null);
        void rpc.call("directory", null).then((result) => {
          setNewTeams(result.teams);
          setNewTeamId((current) => current || result.teams.find((team) => team.key === teamKey)?.id || result.teams[0]?.id || "");
        }).catch((caught: unknown) => setCreateError(message(caught)));
        return;
      }
      if (event.key === "Escape" && creating) {
        event.preventDefault();
        event.stopPropagation();
        setCreating(false);
        setTeamMenu(false);
        setPriorityMenu(false);
        return;
      }
      if (event.key === "Escape" && panelRoute(subPath).issue) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "j" && event.key !== "k") return;
      if (ordered.length === 0) return;
      event.preventDefault();
      const index = ordered.findIndex((issue) => issue.id === openId);
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
      const next = ordered[index < 0 ? (step > 0 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, index + step))];
      if (next) void open(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, openId, subPath, query, project, teamKey, initiativeId, creating]);

  function close() {
    setOpenId(null);
    setCard(null);
    setComments([]);
    setHistory([]);
    setParentIssue(null);
    setChildren([]);
    setLinks([]);
    setStates([]);
    setCardError(null);
    routed.current = "";
    if (panelRoute(subPath).issue) {
      const back = teamKey ? `team/${teamKey}` : initiativeId ? `initiative/${initiativeId}` : project ? `project/${project}` : "";
      navigate.toPluginPanel("linear", { subPath: back, replace: true });
    }
  }

  async function open(issue: LinearIssueRow, fromRoute = false) {
    const token = ++request.current;
    setOpenId(issue.id);
    setCard(issue);
    setComments([]);
    setHistory([]);
    setParentIssue(null);
    setChildren([]);
    setLinks([]);
    setStates([]);
    setDetailReady(false);
    setCardError(null);
    if (!fromRoute && issue.identifier) {
      routed.current = issue.identifier;
      navigate.toPluginPanel("linear", { subPath: issue.identifier, replace: true });
    }
    document.querySelector(`[data-issue-id="${CSS.escape(issue.id)}"]`)?.scrollIntoView({ block: "nearest" });
    try {
      const result = await rpc.call("card", { id: issue.id });
      if (request.current !== token) return;
      if (!result.issue) {
        setCardError("Linear no longer has this issue.");
        return;
      }
      setCard(result.issue);
      setComments(result.comments);
      setHistory(result.history);
      setParentIssue(result.parent);
      setChildren(result.children);
      setLinks(result.links);
      setStates(result.states);
      setDetailReady(true);
    } catch (caught) {
      if (request.current !== token) return;
      setCardError(message(caught));
    }
  }

  async function refreshCard(id: string) {
    const result = await rpc.call("card", { id });
    if (!result.issue) return;
    setCard(result.issue);
    setComments(result.comments);
    setHistory(result.history);
    setParentIssue(result.parent);
    setChildren(result.children);
    setLinks(result.links);
    setStates(result.states);
    setIssues((current) => current?.map((issue) => issue.id === result.issue?.id ? { ...issue, state: result.issue.state, priority: result.issue.priority, priorityLabel: result.issue.priorityLabel, assignee: result.issue.assignee, assigneeId: result.issue.assigneeId } : issue) ?? current);
  }

  async function addComment(body: string) {
    if (!card) return;
    await rpc.call("addComment", { issueId: card.id, body });
    await refreshCard(card.id);
  }

  async function changeStatus(stateId: string) {
    if (!card) return;
    await rpc.call("setStatus", { id: card.id, stateId });
    await refreshCard(card.id);
  }

  async function changePriority(priority: number) {
    if (!card) return;
    await rpc.call("setPriority", { id: card.id, priority });
    await refreshCard(card.id);
  }

  async function changeAssignee(assigneeId: string | null) {
    if (!card || assigneeId === card.assigneeId) return;
    await rpc.call("setAssignee", { id: card.id, assigneeId });
    await refreshCard(card.id);
  }

  function openIdentifier(identifier: string) {
    void open({
      id: identifier,
      identifier,
      title: identifier,
      url: "",
      description: "",
      priority: 0,
      priorityLabel: "",
      state: { id: "", name: "Unknown", type: "unstarted", color: "#bec2c8" },
      project: null,
      projectIcon: "",
      projectColor: "",
      assignee: null,
      assigneeId: "",
      labels: [],
      createdAt: "",
      updatedAt: "",
      dueDate: "",
      milestone: "",
      estimate: null,
      team: null,
    });
  }

  if (connected === false) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 text-foreground"><LinearLogo /> Linear is not connected.</p>
        <p>A workspace admin connects it from Settings. After that, issues open here.</p>
      </div>
    );
  }

  function chooseProject(name: string) {
    setProject(name || null);
    setOpenId(null);
    setCard(null);
    setCardError(null);
    routed.current = "";
    const back = teamKey ? `team/${teamKey}` : initiativeId ? `initiative/${initiativeId}` : "";
    navigate.toPluginPanel("linear", { subPath: name ? `project/${name}` : back, replace: true });
  }

  function chooseStatus(type: string) {
    setStatusFilter(type);
    if (type === "completed" || type === "canceled") setIncludeDone(true);
    setMenu("");
    setFilterField("");
  }

  const activeFilters = [
    statusFilter ? { id: "status", field: "Status", value: STATE_GROUPS.find((group) => group.type === statusFilter)?.label ?? statusFilter } : null,
    priorityFilter ? { id: "priority", field: "Priority", value: PRIORITIES.find((item) => String(item.value) === priorityFilter)?.label ?? "Priority" } : null,
    person ? { id: "assignee", field: "Assignee", value: person === "__none__" ? "Unassigned" : person } : null,
    project ? { id: "project", field: "Project", value: project } : null,
    labelFilter ? { id: "label", field: "Label", value: labelFilter } : null,
  ].flatMap((item) => item ? [item] : []);

  if (panelRoute(subPath).issue) {
    return (
      <div className="@container flex h-full min-h-0 w-full flex-col overflow-y-auto px-4 py-5 @[48rem]:px-8 @[48rem]:py-6">
        <button type="button" onClick={close} className="mb-6 flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover">
          <span aria-hidden className="inline-block size-1.5 border-b border-l border-current" style={{ transform: "rotate(45deg)" }} />
          {heading.title || "My issues"}
        </button>
        {cardError ? <p className="text-[13px] text-destructive">{cardError}</p> : null}
        {card ? (
          <IssueSheet
            card={card}
            comments={comments}
            history={history}
            parent={parentIssue}
            children={children}
            links={links}
            states={states}
            members={members}
            pending={!detailReady && !cardError}
            onComment={addComment}
            onStatus={changeStatus}
            onPriority={changePriority}
            onAssignee={changeAssignee}
            onLoadMembers={() => rpc.call("members", null).then((result) => setMembers(result.users))}
            onOpenIssue={openIdentifier}
            onOpenProject={(name) => navigate.toPluginPanel("linear", { subPath: `project/${name}` })}
            onOpenTeam={(key) => navigate.toPluginPanel("linear", { subPath: `team/${key}` })}
          />
        ) : <p className="text-[13px] text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <LinearLogo className="size-3.5 shrink-0" color={ACCENT} />
        <h1 className="text-[15px] font-medium">{project || heading.title}</h1>
        {issues === null ? null : <span className="text-[12px] tabular-nums text-muted-foreground">{buckets.reduce((sum, group) => sum + group.rows.length, 0)}</span>}
        {project || !heading.detail ? null : <span className="text-[12px] tabular-nums text-muted-foreground">{heading.detail}</span>}
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search issues"
          aria-label="Search issues"
          className="ml-auto h-8 w-56 max-w-full rounded-md border border-transparent bg-muted px-3 text-[13px] outline-none focus:border-border"
        />
        <div ref={menuRef} className="relative flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-expanded={menu === "filter"}
            onClick={() => { setMenu((current) => current === "filter" ? "" : "filter"); setFilterField(""); setFilterQuery(""); }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-muted px-2.5 text-[12px]"
            style={activeFilters.length > 0 ? { background: "rgba(94,106,210,0.12)", color: ACCENT } : undefined}
          >
            <FilterGlyph />
            Filter
          </button>
          {activeFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "status") {
                  if (statusFilter === "completed" || statusFilter === "canceled") setIncludeDone(false);
                  setStatusFilter("");
                } else if (item.id === "priority") setPriorityFilter("");
                else if (item.id === "assignee") setPerson("");
                else if (item.id === "project") chooseProject("");
                else setLabelFilter("");
              }}
              className="flex h-7 max-w-64 items-center gap-1 rounded-full border border-border px-2 text-[12px] hover:bg-state-hover"
            >
              <span className="text-muted-foreground">{item.field}</span>
              <span className="text-muted-foreground">is</span>
              <span className="truncate">{item.value}</span>
              <span aria-hidden className="text-muted-foreground">×</span>
            </button>
          ))}
          <button
            type="button"
            aria-expanded={menu === "display"}
            onClick={() => { setMenu((current) => current === "display" ? "" : "display"); setFilterField(""); }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-muted px-2.5 text-[12px]"
          >
            <DisplayGlyph />
            Display
          </button>
          {menu === "filter" ? (
            <div className="absolute top-9 left-0 z-20 w-52 rounded-md border border-border bg-background p-1 shadow-lg">
              <input
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (filterQuery) setFilterQuery("");
                  else setMenu("");
                }}
                placeholder="Filter…"
                aria-label="Filter the menu"
                className="mb-1 h-8 w-full rounded-md bg-muted px-2 text-[13px] outline-none"
              />
              {filterField === "" ? (
                ([
                  ["status", "Status"],
                  ["priority", "Priority"],
                  ["assignee", "Assignee"],
                  ["project", "Project"],
                  ["label", "Label"],
                ] as const).filter(([, label]) => !filterQuery.trim() || label.toLowerCase().includes(filterQuery.trim().toLowerCase())).map(([field, label]) => (
                  <button key={field} type="button" onClick={() => setFilterField(field)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover">
                    {field === "status" ? <StateIcon state={{ id: "", name: "Status", type: "unstarted", color: "#8A8F98" }} className="size-3.5" /> : null}
                    {field === "priority" ? <PriorityMark priority={2} label="Priority" /> : null}
                    {field === "assignee" ? <span aria-hidden className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/50" /> : null}
                    {field === "project" ? <EntityMark icon="" color="#8A8F98" name="P" /> : null}
                    {field === "label" ? <span aria-hidden className="inline-block h-2 w-3 rounded-full bg-muted-foreground/40" /> : null}
                    {label}
                  </button>
                ))
              ) : (
                <>
                  <button type="button" onClick={() => { setFilterField(""); setFilterQuery(""); }} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[12px] text-muted-foreground hover:bg-state-hover">Back</button>
                  <div className="max-h-64 overflow-y-auto">
                    {filterField === "status" ? STATE_GROUPS.filter((group) => !filterQuery.trim() || group.label.toLowerCase().includes(filterQuery.trim().toLowerCase())).map((group) => {
                      const sample = issues?.find((issue) => issue.state.type === group.type)?.state;
                      return (
                        <button key={group.type} type="button" onClick={() => chooseStatus(group.type)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover">
                          <StateIcon state={sample ?? { id: "", name: group.label, type: group.type, color: "#8A8F98" }} className="size-3.5" />
                          {group.label}
                        </button>
                      );
                    }) : null}
                    {filterField === "priority" ? PRIORITIES.filter((item) => !filterQuery.trim() || item.label.toLowerCase().includes(filterQuery.trim().toLowerCase())).map((item) => (
                      <button key={item.value} type="button" onClick={() => { setPriorityFilter(String(item.value)); setMenu(""); setFilterField(""); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover">
                        <PriorityMark priority={item.value} label={item.label} />
                        {item.label}
                      </button>
                    )) : null}
                    {filterField === "assignee" ? (
                      <>
                        {!filterQuery.trim() || "unassigned".includes(filterQuery.trim().toLowerCase()) ? <button type="button" onClick={() => { setPerson("__none__"); setMenu(""); setFilterField(""); }} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-state-hover">Unassigned</button> : null}
                        {people.filter((name) => !filterQuery.trim() || name.toLowerCase().includes(filterQuery.trim().toLowerCase())).map((name) => (
                          <button key={name} type="button" onClick={() => { setPerson(name); setMenu(""); setFilterField(""); }} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-state-hover">{name}</button>
                        ))}
                      </>
                    ) : null}
                    {filterField === "project" ? projects.filter((name) => !filterQuery.trim() || name.toLowerCase().includes(filterQuery.trim().toLowerCase())).map((name) => (
                      <button key={name} type="button" onClick={() => { chooseProject(name); setMenu(""); setFilterField(""); }} className="flex h-8 w-full items-center truncate rounded-md px-2 text-left text-[13px] hover:bg-state-hover">{name}</button>
                    )) : null}
                    {filterField === "label" ? labels.filter((name) => !filterQuery.trim() || name.toLowerCase().includes(filterQuery.trim().toLowerCase())).map((name) => (
                      <button key={name} type="button" onClick={() => { setLabelFilter(name); setMenu(""); setFilterField(""); }} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-state-hover">{name}</button>
                    )) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
          <button
            type="button"
            aria-expanded={menu === "sort"}
            onClick={() => { setMenu((current) => current === "sort" ? "" : "sort"); setFilterField(""); }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-muted px-2.5 text-[12px]"
          >
            <SortGlyph />
            Sort
            <span className="text-muted-foreground">{SORTS.find((item) => item.value === order)?.label}</span>
          </button>
          {menu === "sort" ? (
            <div className="absolute top-9 right-0 z-20 w-44 rounded-md border border-border bg-background p-1 shadow-lg">
              {SORTS.map((item) => (
                <button key={item.value} type="button" onClick={() => { setOrder(item.value); setMenu(""); }} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-state-hover">
                  {item.label}
                  {order === item.value ? <span style={{ color: ACCENT }}>✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {menu === "display" ? (
            <div className="absolute top-9 right-0 z-20 w-52 rounded-md border border-border bg-background p-2 shadow-lg">
              <p className="px-2 py-1 text-[11px] text-muted-foreground">Grouping</p>
              {([["status", "Status"], ["priority", "Priority"], ["assignee", "Assignee"], ["project", "Project"], ["none", "No grouping"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setGroupBy(value)} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-state-hover">
                  {label}
                  {groupBy === value ? <span style={{ color: ACCENT }}>✓</span> : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIncludeDone((value) => !value)}
                className="mt-1 flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
              >
                Show completed
                {includeDone ? <span style={{ color: ACCENT }}>✓</span> : null}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setCreating((value) => !value);
              setTeamMenu(false);
              setCreateError(null);
              void rpc.call("directory", null).then((result) => {
                setNewTeams(result.teams);
                setNewTeamId((current) => current || result.teams.find((team) => team.key === teamKey)?.id || result.teams[0]?.id || "");
              }).catch((caught: unknown) => setCreateError(message(caught)));
            }}
            className="h-8 rounded-md px-2.5 text-[12px] text-white"
            style={{ background: ACCENT }}
          >
            New issue
          </button>
        </div>
      </div>
      {creating ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTitle.trim();
            if (!title || !newTeamId || createBusy) return;
            setCreateBusy(true);
            setCreateError(null);
            void rpc.call("createIssue", { title, teamId: newTeamId, description: newDescription, priority: newPriority }).then((result) => {
              setCreating(false);
              setTeamMenu(false);
              setPriorityMenu(false);
              setNewTitle("");
              setNewDescription("");
              setNewPriority(0);
              return open({
                id: result.identifier,
                identifier: result.identifier,
                title,
                url: "",
                description: "",
                priority: 0,
                priorityLabel: "",
                state: { id: "", name: "Unknown", type: "unstarted", color: "#bec2c8" },
                project: null,
                projectIcon: "",
                projectColor: "",
                assignee: null,
                assigneeId: "",
                labels: [],
                createdAt: "",
                updatedAt: "",
                dueDate: "",
                milestone: "",
                estimate: null,
                team: null,
              });
            }).catch((caught: unknown) => setCreateError(message(caught))).finally(() => setCreateBusy(false));
          }}
        >
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="Issue title"
            aria-label="New issue title"
            className="h-9 bg-transparent text-[18px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
          <textarea
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            placeholder="Add description…"
            aria-label="New issue description"
            rows={3}
            className="resize-y bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="relative grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Team</span>
            <button
              type="button"
              aria-label="Team for the new issue"
              aria-expanded={teamMenu}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTeamMenu((current) => !current);
              }}
              className="flex h-7 max-w-full items-center rounded-md px-1.5 text-left text-[13px] hover:bg-state-hover"
            >
              <span className="truncate">{newTeams.find((team) => team.id === newTeamId)?.name || "Choose a team"}</span>
            </button>
            {teamMenu ? (
              <div
                onMouseDown={(event) => event.stopPropagation()}
                className="absolute top-8 left-[4.75rem] z-20 max-h-64 w-52 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
              >
                {newTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => {
                      setNewTeamId(team.id);
                      setTeamMenu(false);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
                    style={team.id === newTeamId ? { background: "rgba(94,106,210,0.12)" } : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    {team.id === newTeamId ? <span style={{ color: ACCENT }}>✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="relative grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Priority</span>
            <button
              type="button"
              aria-label="Priority for the new issue"
              aria-expanded={priorityMenu}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPriorityMenu((current) => !current);
              }}
              className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] hover:bg-state-hover"
            >
              <PriorityMark priority={newPriority} label={PRIORITIES.find((item) => item.value === newPriority)?.label ?? "No priority"} />
              <span className="truncate">{PRIORITIES.find((item) => item.value === newPriority)?.label ?? "No priority"}</span>
            </button>
            {priorityMenu ? (
              <div
                onMouseDown={(event) => event.stopPropagation()}
                className="absolute top-8 left-[4.75rem] z-20 w-40 rounded-md border border-border bg-background p-1 shadow-lg"
              >
                {PRIORITIES.map((priority) => (
                  <button
                    key={priority.value}
                    type="button"
                    onClick={() => {
                      setNewPriority(priority.value);
                      setPriorityMenu(false);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover"
                    style={priority.value === newPriority ? { background: "rgba(94,106,210,0.12)" } : undefined}
                  >
                    <PriorityMark priority={priority.value} label={priority.label} />
                    <span className="min-w-0 flex-1 truncate">{priority.label}</span>
                    {priority.value === newPriority ? <span style={{ color: ACCENT }}>✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setCreating(false); setTeamMenu(false); setPriorityMenu(false); setNewDescription(""); setNewPriority(0); }} className="h-7 rounded-md px-2.5 text-[12px] text-muted-foreground hover:bg-state-hover">Cancel</button>
            <button type="submit" disabled={!newTitle.trim() || !newTeamId || createBusy} className="h-7 rounded-md px-2.5 text-[12px] text-white disabled:opacity-40" style={{ background: ACCENT }}>
              {createBusy ? "Creating" : "Create"}
            </button>
          </div>
          {createError ? <p className="text-[13px] text-destructive">{createError}</p> : null}
        </form>
      ) : null}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      {recordError ? <p className="text-[13px] text-destructive">{recordError}</p> : null}
      <div className="@container grid min-h-0 flex-1 grid-cols-1 gap-6 @[52rem]:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]">
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
      {record && (record.summary || record.content.trim() || record.documents.length > 0 || record.projects.length > 0 || record.lead || record.targetDate || record.startDate || record.milestones.length > 0) ? (
        <section className="flex flex-col gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <EntityMark icon={record.icon} color={record.color} name={record.title || "Project"} />
            <h2 className="min-w-0 truncate text-[15px] font-medium">{record.title}</h2>
          </div>
          {record.summary && record.summary !== record.content.trim() ? <p className="text-[13px] leading-6 text-muted-foreground">{record.summary}</p> : null}
          {record.content.trim() ? <Description text={record.content} onOpenIssue={openIdentifier} /> : null}
          {record.projects.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] font-medium text-muted-foreground">Projects</h3>
              {record.projects.map((item) => (
                <button key={item.id} type="button" onClick={() => chooseProject(item.name)} className="flex h-8 items-center gap-2 rounded-md px-1 text-left text-[13px] hover:bg-state-hover">
                  <EntityMark icon={item.icon} color={item.color} name={item.name} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.state ? <span className="text-[12px] capitalize text-muted-foreground">{item.state}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {record.documents.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[12px] font-medium text-muted-foreground">Documents</h3>
              {record.documents.map((doc) => (
                <div key={doc.id} className="flex flex-col gap-2">
                  <button type="button" onClick={() => setOpenDoc((current) => current === doc.id ? null : doc.id)} className="flex h-8 items-center gap-2 rounded-md px-1 text-left text-[13px] hover:bg-state-hover">
                    <EntityMark icon={doc.icon} color={record.color} name={doc.title} />
                    <span className="min-w-0 truncate">{doc.title}</span>
                  </button>
                  {openDoc === doc.id && doc.content.trim() ? <Description text={doc.content} onOpenIssue={openIdentifier} /> : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
          {issues === null && !error ? <p className="p-3 text-[13px] text-muted-foreground">Loading…</p> : null}
          {issues !== null && visible.length === 0 ? <p className="p-3 text-[13px] text-muted-foreground">{query.trim() || activeFilters.length > 0 ? "Nothing matches." : "No issues in this view."}</p> : null}
          {buckets.map((group) => {
            const rows = group.rows;
            const shut = folded.has(group.id);
            return (
              <section key={group.id} className="pt-2 first:pt-0">
                <h2 className="sticky top-0 z-10 bg-background">
                  <button
                    type="button"
                    aria-expanded={!shut}
                    onClick={() => setFolded((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] font-medium text-muted-foreground hover:bg-state-hover"
                  >
                    <span aria-hidden className="inline-block size-1.5 border-b border-r border-current" style={{ transform: shut ? "rotate(-45deg)" : "rotate(45deg)" }} />
                    {rows[0] && groupBy === "status" ? <StateIcon state={rows[0].state} className="size-3.5" /> : null}
                    {rows[0] && groupBy === "priority" ? <PriorityMark priority={rows[0].priority} label={group.label} /> : null}
                    {rows[0] && groupBy === "assignee" ? (rows[0].assignee ? <AssigneeMark name={rows[0].assignee} /> : <span aria-hidden className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/40" />) : null}
                    {rows[0] && groupBy === "project" && rows[0].project ? <EntityMark icon={rows[0].projectIcon} color={rows[0].projectColor || "#8A8F98"} name={rows[0].project} /> : null}
                    {group.label}
                    <span className="opacity-60">{rows.length}</span>
                  </button>
                </h2>
                {shut ? null : (
                <ul>
                  {rows.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => void open(issue)}
                        data-issue-id={issue.id}
                        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-state-hover"
                        style={openId === issue.id ? { background: "rgba(94,106,210,0.12)" } : undefined}
                      >
                        <StateIcon state={issue.state} className="size-3.5" />
                        <span className="w-[4.5rem] shrink-0 text-[12px] tabular-nums text-muted-foreground">{issue.identifier}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
                        {issue.project && issue.project !== project ? (
                          <span className="hidden max-w-36 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground sm:inline-flex" title={issue.project}>
                            <EntityMark icon={issue.projectIcon} color={issue.projectColor || "#8A8F98"} name={issue.project} />
                            <span className="truncate">{issue.project}</span>
                          </span>
                        ) : null}
                        {issue.labels[0] ? <span className="hidden sm:inline-flex"><LabelPill name={issue.labels[0].name} color={issue.labels[0].color} extra={issue.labels.length > 1 ? issue.labels.length - 1 : undefined} /></span> : null}
                        {issue.estimate === null ? null : <span className="hidden h-4 min-w-4 shrink-0 items-center justify-center rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground sm:inline-flex" title="Estimate">{issue.estimate}</span>}
                        <span className="inline-flex w-3 shrink-0 justify-center"><PriorityMark priority={issue.priority} label={issue.priorityLabel} /></span>
                        <span className="hidden sm:inline-flex">
                          {issue.assignee ? <span className="sr-only">{issue.assignee}</span> : null}
                          {issue.assignee ? <AssigneeMark name={issue.assignee} /> : <span aria-hidden title="Unassigned" className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/40" />}
                        </span>
                        {issue.dueDate ? <span className="hidden w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground sm:inline" style={isOverdue(issue.dueDate, issue.state.type) ? { color: "#EB5757" } : undefined}>{duePhrase(issue.dueDate)}</span> : null}
                        <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{issue.updatedAt ? ageLabel(issue.updatedAt) : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                )}
              </section>
            );
          })}
      </div>
      </div>
      <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-border @[52rem]:flex @[52rem]:border-l @[52rem]:pl-5">
        {record && record.progress !== null ? (
          <div className="flex items-center gap-3">
            <ProgressRing value={record.progress} />
            <div className="flex flex-col">
              <span className="text-[12px] text-muted-foreground">Progress</span>
              <span className="text-[15px] font-medium tabular-nums">{Math.round(record.progress * 100)}%</span>
            </div>
          </div>
        ) : null}
        {record && (record.lead || record.startDate || record.targetDate) ? (
          <div className="flex flex-col gap-2">
            {record.lead ? (
              <div className="flex items-center gap-2 text-[13px]">
                <AssigneeMark name={record.lead} />
                <span className="min-w-0 truncate">{record.lead}</span>
              </div>
            ) : null}
            {record.startDate || record.targetDate ? (
              <p className="text-[12px] text-muted-foreground">
                {[record.startDate ? dayLabel(record.startDate) : "", record.targetDate ? dayLabel(record.targetDate) : ""].filter(Boolean).join(" → ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-3">
          <h2 className="text-[12px] text-muted-foreground">Status</h2>
          <ScopeGraph parts={visible.map((issue) => issue.state)} />
        </div>
        {record && record.milestones.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-[12px] text-muted-foreground">Milestones</h2>
            {record.milestones.map((milestone) => (
              <div key={milestone.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex min-w-0 items-center gap-1.5"><MilestoneMark /><span className="truncate">{milestone.name}</span></span>
                  <span className="tabular-nums text-muted-foreground">{Math.round(milestone.progress * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, Math.round(milestone.progress * 100)))}%`, background: record.color || ACCENT }} />
                </div>
                {milestone.targetDate ? <p className="text-[12px] text-muted-foreground">{dayLabel(milestone.targetDate)}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </aside>
      </div>
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

function SideGlyph({ d, active }: { d: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`size-4 shrink-0 ${active ? "text-foreground" : "text-muted-foreground"}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ScopeGraph({ parts }: { parts: Array<{ name: string; type: string; color: string }> }) {
  const rank = new Map(STATE_GROUPS.map((group, index) => [group.type, index]));
  const byName = new Map<string, { name: string; type: string; color: string; count: number }>();
  for (const part of parts) {
    const name = part.name || "Unknown";
    const current = byName.get(name);
    if (current) current.count += 1;
    else byName.set(name, { name, type: part.type, color: part.color || "#8A8F98", count: 1 });
  }
  const groups = [...byName.values()].sort((left, right) => (rank.get(left.type) ?? 99) - (rank.get(right.type) ?? 99) || left.name.localeCompare(right.name));
  if (parts.length === 0) return <p className="text-[12px] text-muted-foreground">No issues in this view.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {groups.map((group) => (
          <span key={group.name} style={{ width: `${(group.count / parts.length) * 100}%`, background: group.color }} />
        ))}
      </div>
      {groups.map((group) => (
        <div key={group.name} className="flex items-center gap-2 text-[13px]">
          <StateIcon state={{ id: "", name: group.name, type: group.type, color: group.color }} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <span className="tabular-nums text-muted-foreground">{group.count}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const radius = 14;
  const turn = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 36 36" className="size-10 shrink-0" aria-hidden>
      <circle cx="18" cy="18" r={radius} fill="none" className="stroke-muted-foreground/25" strokeWidth="3" />
      <circle cx="18" cy="18" r={radius} fill="none" stroke="#5E6AD2" strokeWidth="3" strokeDasharray={`${turn * pct} ${turn}`} strokeLinecap="round" transform="rotate(-90 18 18)" />
    </svg>
  );
}

function CalendarMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 text-muted-foreground">
      <path d="M3.5 3.5h9v9h-9ZM3.5 6.5h9M6 2.5v2M10 2.5v2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MilestoneMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 text-muted-foreground">
      <path d="M8 1.8 13.4 8 8 14.2 2.6 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SortGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0">
      <path d="M4 3.5v9M2.2 10.7 4 12.5l1.8-1.8M8 4.5h5M8 8h3.5M8 11.5h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0">
      <path d="M2.5 3.5h11l-4 5v3.5l-3 1.5V8.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function DisplayGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0">
      <path d="M3 4.5h10M3 8h7M3 11.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EntityMark({ icon, color, name }: { icon: string; color: string; name: string }) {
  const emoji = /^\p{Extended_Pictographic}/u.test(icon);
  if (emoji) return <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">{icon}</span>;
  return (
    <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-medium leading-none text-white" style={{ backgroundColor: color || "#8A8F98" }}>
      {name.trim().slice(0, 1).toUpperCase() || "•"}
    </span>
  );
}

function TeamMark({ team }: { team: LinearDirectoryTeam }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-medium leading-none text-white"
      style={{ backgroundColor: team.color }}
    >
      {team.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function sideRowStyle(active: boolean, depth: number): { paddingLeft: number; background?: string } {
  return {
    paddingLeft: 8 + depth * 16,
    ...(active ? { background: "var(--state-active)" } : {}),
  };
}

function teamKeyOf(identifier: string, teams: readonly LinearDirectoryTeam[]): string | null {
  let found: LinearDirectoryTeam | null = null;
  for (const team of teams) {
    if (!identifier.startsWith(`${team.key}-`)) continue;
    if (!found || team.key.length > found.key.length) found = team;
  }
  return found?.key ?? null;
}

function LinearSidebar({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof linearRpc>();
  const navigate = useBbNavigate();
  const route = panelRoute(subPath);
  const anchor = useRef<HTMLDivElement>(null);
  const [topRow, setTopRow] = useState<HTMLElement | null>(null);
  const [directory, setDirectory] = useState<LinearDirectory | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [initiativesOpen, setInitiativesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [openTeams, setOpenTeams] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    const body = anchor.current?.closest("[data-testid='plugin-sidebar-body']");
    const reserve = body?.querySelector<HTMLElement>("[data-testid='plugin-sidebar-top-reserve-row']") ?? null;
    if (reserve && reserve.getBoundingClientRect().height < 28) {
      reserve.style.height = "var(--bb-app-chrome-row-height)";
    }
    setTopRow(reserve);
    return () => {
      if (reserve) reserve.style.height = "";
    };
  }, []);

  useEffect(() => {
    let live = true;
    void rpc.call("directory", null).then((result) => {
      if (live) setDirectory(result);
    }).catch(() => {
      if (live) setDirectory(null);
    });
    return () => { live = false; };
  }, [rpc]);

  const teams = directory?.teams ?? [];
  const projects = sidebarProjects(directory?.projects ?? []);
  const activeTeamKey = route.team || (route.issue ? teamKeyOf(route.issue, teams) : null);

  useEffect(() => {
    if (route.project) setProjectsOpen(true);
    if (route.initiative) setInitiativesOpen(true);
    if (!activeTeamKey) return;
    const team = teams.find((item) => item.key === activeTeamKey);
    if (!team) return;
    setOpenTeams((current) => {
      const next = new Set(current);
      const seen = new Set<string>();
      let id: string | null = team.id;
      while (id && !seen.has(id)) {
        seen.add(id);
        next.add(id);
        id = teams.find((item) => item.id === id)?.parentId ?? null;
      }
      return next;
    });
  }, [route.project, route.initiative, activeTeamKey, teams]);

  function go(path: string) {
    navigate.toPluginPanel("linear", { subPath: path });
  }

  function toggleTeam(id: string) {
    setOpenTeams((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderTeams(parentId: string | null, depth: number): ReactNode {
    return teams.filter((team) => {
      const parent = team.parentId && teams.some((item) => item.id === team.parentId) ? team.parentId : null;
      return parent === parentId;
    }).map((team) => {
      const open = openTeams.has(team.id);
      const issuesActive = activeTeamKey === team.key && !route.project;
      return (
        <div key={team.id}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleTeam(team.id)}
            className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
            style={sideRowStyle(false, depth)}
          >
            <TeamMark team={team} />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <FoldMark open={open} />
          </button>
          {open ? (
            <button
              type="button"
              onClick={() => go(`team/${team.key}`)}
              className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
              style={sideRowStyle(issuesActive, depth + 1)}
            >
              <SideGlyph d="M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5Z M8 6v2.2" active={issuesActive} />
              Issues
            </button>
          ) : null}
          {open ? renderTeams(team.id, depth + 1) : null}
        </div>
      );
    });
  }

  const header = (
    <div className="order-first flex h-full min-w-0 flex-1 items-center gap-2 text-[13px] font-medium text-foreground">
      <LinearLogo className="size-4 shrink-0" color={ACCENT} />
      <span className="min-w-0 truncate">{directory?.workspace || "Linear"}</span>
    </div>
  );
  const myIssues = !route.issue && !route.team && !route.project && !route.initiative;

  return (
    <div ref={anchor} className="flex min-h-0 flex-col pb-2 text-[13px]">
      {topRow ? createPortal(header, topRow) : header}
      <button
        type="button"
        onClick={() => go("")}
        className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
        style={sideRowStyle(myIssues, 0)}
      >
        <SideGlyph d="M8 2.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM3.75 13.25c.45-2.15 2.05-3.25 4.25-3.25s3.8 1.1 4.25 3.25" active={myIssues} />
        My issues
      </button>
      <button
        type="button"
        aria-expanded={workspaceOpen}
        onClick={() => setWorkspaceOpen((open) => !open)}
        className="mt-3 flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12px] text-muted-foreground hover:bg-state-hover"
        style={sideRowStyle(false, 0)}
      >
        Workspace
        <FoldMark open={workspaceOpen} />
      </button>
      {workspaceOpen ? (
        <>
          <button
            type="button"
            aria-expanded={initiativesOpen}
            onClick={() => setInitiativesOpen((open) => !open)}
            className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
            style={sideRowStyle(false, 0)}
          >
            <SideGlyph d="M8 1.75 13.25 4.75v6.5L8 14.25 2.75 11.25v-6.5Z" />
            <span className="min-w-0 flex-1 truncate">Initiatives</span>
            <FoldMark open={initiativesOpen} />
          </button>
          {initiativesOpen ? (directory?.initiatives ?? []).map((initiative) => (
            <button
              key={initiative.id}
              type="button"
              onClick={() => go(`initiative/${initiative.id}`)}
              className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
              style={sideRowStyle(route.initiative === initiative.id, 1)}
            >
              <EntityMark icon={initiative.icon} color={initiative.color} name={initiative.name} />
              <span className="min-w-0 truncate">{initiative.name}</span>
            </button>
          )) : null}
          <button
            type="button"
            aria-expanded={projectsOpen}
            onClick={() => setProjectsOpen((open) => !open)}
            className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
            style={sideRowStyle(false, 0)}
          >
            <SideGlyph d="M2.75 4.25h4l1.1 1.35h5.4v6.9h-10.5Z" />
            <span className="min-w-0 flex-1 truncate">Projects</span>
            <FoldMark open={projectsOpen} />
          </button>
          {projectsOpen ? projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => go(`project/${project.name}`)}
              className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-state-hover"
              style={sideRowStyle(route.project === project.name, 1)}
            >
              <EntityMark icon={project.icon} color={project.color} name={project.name} />
              <span className="min-w-0 truncate">{project.name}</span>
            </button>
          )) : null}
        </>
      ) : null}
      <button
        type="button"
        aria-expanded={teamsOpen}
        onClick={() => setTeamsOpen((open) => !open)}
        className="mt-3 flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12px] text-muted-foreground hover:bg-state-hover"
        style={sideRowStyle(false, 0)}
      >
        Your teams
        <FoldMark open={teamsOpen} />
      </button>
      {teamsOpen ? renderTeams(null, 0) : null}
    </div>
  );
}

function LinearSettings(_props: PluginSettingsSectionProps) {
  const rpc = useRpc<typeof linearRpc>();
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [redirect, setRedirect] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    const result = await rpc.call("status", null);
    setConnected(result.connected);
    setRedirect(result.redirectUri);
    setReady(result.credentialsReady);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setStatus(message(error)));
  }, [rpc]);

  return (
    <Page title="Linear" lede="A workspace admin connects Linear once. Issues then open on the Linear page. The token stays on this server.">
      <Panel title={connected ? "Connected" : "Not connected"} lede={ready ? "The client id and secret are saved in the configuration fields above. Register the redirect, then connect." : "Add the client id and secret in the configuration fields above. Register the redirect in Linear, then connect."}>
        {redirect ? (
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground">Register this redirect in the Linear OAuth application: {redirect}</p>
        ) : <p className="text-sm text-muted-foreground">Set BB_APP_URL to the address people open this app on. The redirect is built from it.</p>}
        <div className="flex flex-wrap gap-2">
          <Primary onClick={() => {
            void rpc.call("connectUrl", null).then((result) => {
              window.location.assign(result.url);
            }).catch((error: unknown) => setStatus(message(error)));
          }}>Connect Linear</Primary>
          <Quiet onClick={() => {
            void rpc.call("disconnect", null).then(() => load()).catch((error: unknown) => setStatus(message(error)));
          }}>Disconnect</Quiet>
        </div>
      </Panel>
      {status ? <Note>{status}</Note> : null}
    </Page>
  );
}

function LinearInfo({ threadId }: ExperimentalThreadInfoProps) {
  const rpc = useRpc<typeof linearRpc>();
  const navigate = useBbNavigate();
  const [view, setView] = useState<Awaited<ReturnType<typeof rpc.call<"overview">>> | null>(null);

  useEffect(() => {
    let live = true;
    void rpc.call("overview", { threadId }).then((result) => {
      if (live) setView(result);
    }).catch(() => {
      if (live) setView({ kind: "none" });
    });
    return () => { live = false; };
  }, [rpc, threadId]);

  if (!view || view.kind === "none") return null;
  if (view.kind === "error") {
    return <InfoSection label="Linear"><p className="px-2 py-1 text-xs text-destructive">{view.message}</p></InfoSection>;
  }
  if (view.kind === "unmatched") {
    const noun = view.rank === "vp" ? "initiative" : "team";
    return <InfoSection label="Linear"><p className="px-2 py-1 text-xs text-muted-foreground">No Linear {noun} matches {view.area}.</p></InfoSection>;
  }
  const mark = <LinearLogo className="size-3 text-foreground" />;
  if (view.kind === "initiative") {
    return (
      <InfoSection label={view.name} count={view.projects.length} accessory={mark} trailing={<span className="text-2xs text-muted-foreground">{view.status}</span>}>
        <InfoList
          items={view.projects}
          getKey={(project) => project.id}
          limit={8}
          renderItem={(project) => (
            <InfoListRow
              leading={<span aria-hidden className="inline-block size-2 shrink-0 rounded-[2px] border" style={project.state === "started" ? { borderColor: ACCENT, background: ACCENT } : { borderColor: "currentColor", opacity: 0.45 }} />}
              name={project.name}
              title={project.name}
              context={project.state}
              onSelect={() => navigate.toPluginPanel("linear", { subPath: `project/${project.name}` })}
            />
          )}
        />
      </InfoSection>
    );
  }
  const issues = openWork(view.issues);
  return (
    <InfoSection label={view.name} count={issues.length} accessory={mark} trailing={<span className="text-2xs font-medium tracking-wide text-muted-foreground">{view.key}</span>}>
      <InfoList
        items={issues}
        getKey={(issue) => issue.id}
        limit={8}
        renderItem={(issue) => (
          <InfoListRow
            leading={<StateIcon state={issue.state} className="size-3" />}
            leadingLabel={issue.state.name}
            name={<><span className="mr-1.5 font-medium tabular-nums text-muted-foreground">{issue.identifier}</span>{issue.title}</>}
            title={`${issue.identifier} ${issue.title}`}
            context={issue.updatedAt ? ageLabel(issue.updatedAt) : undefined}
            trailing={<span className="inline-flex items-center gap-1.5"><PriorityMark priority={issue.priority} label={issue.priorityLabel} />{issue.assignee ? <AssigneeMark name={issue.assignee} /> : <span aria-hidden className="inline-block size-4 rounded-full border border-dashed border-muted-foreground/40" />}</span>}
            onSelect={() => navigate.toPluginPanel("linear", { subPath: issue.identifier })}
          />
        )}
      />
    </InfoSection>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "linear",
    title: "Linear",
    icon: "Linear",
    path: "linear",
    component: LinearBoard,
    experimental_sidebar: LinearSidebar,
  });
  app.slots.settingsSection({
    id: "linear",
    component: LinearSettings,
  });
  app.slots.experimental_threadInfoSection({
    id: "linear",
    group: experimental_THREAD_INFO_SECTION_GROUPS.related,
    order: 40,
    component: LinearInfo,
  });
});
