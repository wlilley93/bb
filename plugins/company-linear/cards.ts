export const STATE_GROUPS = [
  { type: "started", label: "In progress" },
  { type: "unstarted", label: "Todo" },
  { type: "triage", label: "Triage" },
  { type: "backlog", label: "Backlog" },
  { type: "completed", label: "Done" },
  { type: "canceled", label: "Canceled" },
] as const;

export interface LinearIssueRow {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; type: string; color: string };
  project: string | null;
  projectIcon: string;
  projectColor: string;
  assignee: string | null;
  assigneeId: string;
  labels: Array<{ name: string; color: string }>;
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  milestone: string;
  estimate: number | null;
  team: { key: string; name: string; color: string } | null;
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  author: string | null;
}

export interface LinearChange {
  id: string;
  createdAt: string;
  author: string | null;
  text: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
}

export function matchesQuery(issue: Pick<LinearIssueRow, "identifier" | "title" | "assignee" | "project" | "labels">, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  const fields = [issue.identifier, issue.title, issue.assignee ?? "", issue.project ?? "", ...issue.labels.map((label) => label.name)];
  return fields.some((field) => field.toLowerCase().includes(query));
}

export function openWork<T extends { state: { type: string } }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.state.type !== "completed" && row.state.type !== "canceled");
}

export interface LinearDirectoryTeam {
  id: string;
  key: string;
  name: string;
  color: string;
  parentId: string | null;
}

export interface LinearDirectoryProject {
  id: string;
  name: string;
  icon: string;
  color: string;
  state: string;
  teamIds: string[];
}

export interface LinearDirectory {
  workspace: string;
  teams: LinearDirectoryTeam[];
  initiatives: Array<{ id: string; name: string; icon: string; color: string }>;
  projects: LinearDirectoryProject[];
}

export interface LinearDocument {
  id: string;
  title: string;
  icon: string;
  content: string;
}

export interface LinearChild {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: string; color: string };
}

export interface LinearParent {
  identifier: string;
  title: string;
  state: { name: string; type: string; color: string };
}

export interface LinearRecord {
  title: string;
  summary: string;
  content: string;
  icon: string;
  color: string;
  documents: LinearDocument[];
  projects: Array<{ id: string; name: string; icon: string; color: string; state: string }>;
  lead: string;
  startDate: string;
  targetDate: string;
  progress: number | null;
  milestones: Array<{ id: string; name: string; progress: number; targetDate: string }>;
}

export interface LinearLink {
  id: string;
  label: string;
  identifier: string;
  title: string;
  state: { name: string; type: string; color: string };
}

export type IssueOrder = "priority" | "updated" | "created" | "due" | "title";
export type IssueGroup = "status" | "priority" | "assignee" | "project" | "none";

export interface IssueBucket {
  id: string;
  label: string;
  rows: LinearIssueRow[];
}

const TEAM_COLOR = "#5E6AD2";

function markColor(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "#8A8F98";
  return colorOf(value);
}

function colorOf(value: unknown): string {
  if (typeof value !== "string") return TEAM_COLOR;
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [red, green, blue] = raw.slice(1).split("");
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  return TEAM_COLOR;
}

function nodesOf(data: unknown, field: string): unknown[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>)[field] : undefined;
  const nodes = root && typeof root === "object" ? (root as { nodes?: unknown }).nodes : undefined;
  return Array.isArray(nodes) ? nodes : [];
}

export function parseDirectory(data: unknown): LinearDirectory {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const organization = root.organization && typeof root.organization === "object" ? root.organization as { name?: unknown } : {};
  const teams = nodesOf(root, "teams").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textOf(record.id);
    const key = textOf(record.key);
    const name = textOf(record.name);
    if (!id || !key || !name) return [];
    const parent = record.parent && typeof record.parent === "object" ? textOf((record.parent as { id?: unknown }).id) : "";
    return [{ id, key, name, color: colorOf(record.color), parentId: parent || null }];
  });
  const initiatives = nodesOf(root, "initiatives").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textOf(record.id);
    const name = textOf(record.name);
    return id && name ? [{ id, name, icon: textOf(record.icon), color: markColor(record.color) }] : [];
  });
  const projects = nodesOf(root, "projects").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textOf(record.id);
    const name = textOf(record.name);
    if (!id || !name) return [];
    const teamIds = nodesOf(record, "teams").flatMap((team) => {
      if (!team || typeof team !== "object") return [];
      const teamId = textOf((team as { id?: unknown }).id);
      return teamId ? [teamId] : [];
    });
    return [{ id, name, icon: textOf(record.icon), color: markColor(record.color), state: textOf(record.state), teamIds }];
  });
  return { workspace: textOf(organization.name), teams, initiatives, projects };
}

export function parseUsers(data: unknown): Array<{ id: string; name: string }> {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return nodesOf(root, "users").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    if (record.active === false) return [];
    const id = textOf(record.id);
    const name = textOf(record.name);
    return id && name ? [{ id, name }] : [];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

const PRIORITY_BUCKETS = [
  { id: "1", label: "Urgent" },
  { id: "2", label: "High" },
  { id: "3", label: "Medium" },
  { id: "4", label: "Low" },
  { id: "0", label: "No priority" },
];

export function compareIssues(order: IssueOrder) {
  return (left: Pick<LinearIssueRow, "priority" | "updatedAt" | "createdAt" | "title" | "dueDate">, right: Pick<LinearIssueRow, "priority" | "updatedAt" | "createdAt" | "title" | "dueDate">) => {
    if (order === "title") return left.title.localeCompare(right.title);
    if (order === "created") return Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");
    if (order === "updated") return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    if (order === "due") return dueStamp(left.dueDate) - dueStamp(right.dueDate);
    return byPriority(left, right);
  };
}

export function groupIssues(issues: readonly LinearIssueRow[], group: IssueGroup, order: IssueOrder): IssueBucket[] {
  const sort = compareIssues(order);
  if (group === "none") return [{ id: "all", label: "Issues", rows: issues.slice().sort(sort) }];
  if (group === "priority") {
    return PRIORITY_BUCKETS.flatMap((bucket) => {
      const rows = issues.filter((issue) => String(issue.priority) === bucket.id).sort(sort);
      return rows.length === 0 ? [] : [{ id: bucket.id, label: bucket.label, rows }];
    });
  }
  if (group === "assignee" || group === "project") {
    const valueOf = group === "assignee"
      ? (issue: LinearIssueRow) => issue.assignee ?? ""
      : (issue: LinearIssueRow) => issue.project ?? "";
    const empty = group === "assignee" ? "Unassigned" : "No project";
    const names = [...new Set(issues.map(valueOf))].sort((left, right) => {
      if (!left) return 1;
      if (!right) return -1;
      return left.localeCompare(right);
    });
    return names.map((name) => ({
      id: name || "__none__",
      label: name || empty,
      rows: issues.filter((issue) => valueOf(issue) === name).sort(sort),
    }));
  }
  return STATE_GROUPS.flatMap((bucket) => {
    const rows = issues.filter((issue) => issue.state.type === bucket.type).sort(sort);
    return rows.length === 0 ? [] : [{ id: bucket.type, label: bucket.label, rows }];
  });
}

export function parseRecord(data: unknown, kind: "project" | "initiative"): LinearRecord {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const source = kind === "project"
    ? nodesOf(root, "projects")[0]
    : root.initiative;
  const record = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const documents = [...nodesOf(record, "documents"), ...nodesOf(root, "documents")].flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const item = node as Record<string, unknown>;
    const id = textOf(item.id);
    const title = textOf(item.title);
    if (!id || !title) return [];
    return [{ id, title, icon: textOf(item.icon), content: textOf(item.content) }];
  });
  return {
    title: textOf(record.name),
    summary: textOf(record.description),
    content: textOf(record.content),
    icon: textOf(record.icon),
    color: markColor(record.color),
    documents,
    projects: nodesOf(record, "projects").flatMap((node) => {
      if (!node || typeof node !== "object") return [];
      const item = node as Record<string, unknown>;
      const id = textOf(item.id);
      const name = textOf(item.name);
      if (!id || !name) return [];
      return [{ id, name, icon: textOf(item.icon), color: markColor(item.color), state: textOf(item.state) }];
    }),
    lead: record.lead && typeof record.lead === "object" ? textOf((record.lead as { name?: unknown }).name) : "",
    startDate: textOf(record.startDate),
    targetDate: textOf(record.targetDate),
    progress: typeof record.progress === "number" && Number.isFinite(record.progress) ? record.progress : null,
    milestones: nodesOf(record, "projectMilestones").flatMap((node) => {
      if (!node || typeof node !== "object") return [];
      const item = node as Record<string, unknown>;
      const id = textOf(item.id);
      const name = textOf(item.name);
      if (!id || !name) return [];
      const progress = typeof item.progress === "number" && Number.isFinite(item.progress) ? item.progress : 0;
      return [{ id, name, progress, targetDate: textOf(item.targetDate) }];
    }),
  };
}

function dueStamp(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.POSITIVE_INFINITY;
}

export function isOverdue(iso: string, stateType: string, now = Date.now()): boolean {
  if (!iso || stateType === "completed" || stateType === "canceled") return false;
  const due = dueStamp(iso);
  if (!Number.isFinite(due)) return false;
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return due < start;
}

export function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function duePhrase(iso: string, now = Date.now()): string {
  const due = dueStamp(iso);
  if (!Number.isFinite(due)) return "";
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const day = 86_400_000;
  if (due === start) return "Today";
  if (due === start + day) return "Tomorrow";
  if (due === start - day) return "Yesterday";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  if (Number(match[1]) === today.getUTCFullYear()) {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(due));
  }
  return dayLabel(iso);
}

export function parseRelations(data: unknown): { parent: LinearParent | null; children: LinearChild[]; links: LinearLink[] } {
  const issue = data && typeof data === "object" ? (data as { issue?: unknown }).issue : undefined;
  const record = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
  const parentNode = record.parent && typeof record.parent === "object" ? record.parent as Record<string, unknown> : null;
  const parentId = textOf(parentNode?.identifier);
  const parentTitle = textOf(parentNode?.title);
  const parentState = parentNode?.state && typeof parentNode.state === "object" ? parentNode.state as Record<string, unknown> : {};
  const parent = parentId && parentTitle ? {
    identifier: parentId,
    title: parentTitle,
    state: { name: textOf(parentState.name) || "Unknown", type: textOf(parentState.type) || "unstarted", color: textOf(parentState.color) || "#bec2c8" },
  } : null;
  const children = nodesOf(record, "children").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const item = node as Record<string, unknown>;
    const id = textOf(item.id);
    const identifier = textOf(item.identifier);
    const title = textOf(item.title);
    if (!id || !identifier || !title) return [];
    const state = item.state && typeof item.state === "object" ? item.state as Record<string, unknown> : {};
    return [{
      id,
      identifier,
      title,
      state: { name: textOf(state.name) || "Unknown", type: textOf(state.type) || "unstarted", color: textOf(state.color) || "#bec2c8" },
    }];
  });
  const forward: Record<string, string> = { blocks: "Blocks", duplicate: "Duplicate of", related: "Related to" };
  const inverse: Record<string, string> = { blocks: "Blocked by", duplicate: "Duplicated by", related: "Related to" };
  const links = [
    ...linkNodes(nodesOf(record, "relations"), "relatedIssue", forward),
    ...linkNodes(nodesOf(record, "inverseRelations"), "issue", inverse),
  ];
  return { parent, children, links };
}

function linkNodes(nodes: unknown[], field: "relatedIssue" | "issue", labels: Record<string, string>): LinearLink[] {
  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const item = node as Record<string, unknown>;
    const id = textOf(item.id);
    const label = labels[textOf(item.type)];
    const other = item[field] && typeof item[field] === "object" ? item[field] as Record<string, unknown> : null;
    const identifier = textOf(other?.identifier);
    const title = textOf(other?.title);
    if (!id || !label || !identifier || !title) return [];
    const state = other?.state && typeof other.state === "object" ? other.state as Record<string, unknown> : {};
    return [{
      id,
      label,
      identifier,
      title,
      state: { name: textOf(state.name) || "Unknown", type: textOf(state.type) || "unstarted", color: textOf(state.color) || "#bec2c8" },
    }];
  });
}

export function byPriority(left: Pick<LinearIssueRow, "priority" | "updatedAt">, right: Pick<LinearIssueRow, "priority" | "updatedAt">): number {
  const rank = (priority: number) => priority === 0 ? 5 : priority;
  const priority = rank(left.priority) - rank(right.priority);
  if (priority !== 0) return priority;
  return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
}

export function sidebarProjects<T extends { state: string }>(projects: readonly T[]): T[] {
  return projects.filter((project) => {
    const state = project.state.toLowerCase();
    return state !== "completed" && state !== "canceled" && state !== "cancelled";
  });
}

export function ageLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!iso || Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseOne(node: unknown): LinearIssueRow | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const id = textOf(record.id);
  const identifier = textOf(record.identifier);
  const title = textOf(record.title);
  if (!id || !identifier || !title) return null;
  const state = record.state && typeof record.state === "object" ? record.state as Record<string, unknown> : {};
  const projectNode = record.project && typeof record.project === "object" ? record.project as { name?: unknown; icon?: unknown; color?: unknown } : null;
  const project = textOf(projectNode?.name);
  const assigneeNode = record.assignee && typeof record.assignee === "object" ? record.assignee as { id?: unknown; name?: unknown } : null;
  const assignee = textOf(assigneeNode?.name);
  const labelNodes = record.labels && typeof record.labels === "object" && Array.isArray((record.labels as { nodes?: unknown }).nodes)
    ? (record.labels as { nodes: unknown[] }).nodes
    : [];
  const team = record.team && typeof record.team === "object" ? record.team as { key?: unknown; name?: unknown; color?: unknown } : null;
  const teamKey = textOf(team?.key);
  const teamName = textOf(team?.name);
  return {
    id,
    identifier,
    title,
    url: textOf(record.url),
    description: textOf(record.description),
    priority: typeof record.priority === "number" ? record.priority : 0,
    priorityLabel: textOf(record.priorityLabel),
    state: { id: textOf(state.id), name: textOf(state.name) || "Unknown", type: textOf(state.type) || "unstarted", color: textOf(state.color) || "#bec2c8" },
    project: project || null,
    projectIcon: textOf(projectNode?.icon),
    projectColor: project ? markColor(projectNode?.color) : "",
    assignee: assignee || null,
    assigneeId: textOf(assigneeNode?.id),
    createdAt: textOf(record.createdAt),
    updatedAt: textOf(record.updatedAt),
    dueDate: textOf(record.dueDate),
    milestone: record.projectMilestone && typeof record.projectMilestone === "object" ? textOf((record.projectMilestone as { name?: unknown }).name) : "",
    estimate: typeof record.estimate === "number" && Number.isFinite(record.estimate) ? record.estimate : null,
    labels: labelNodes.flatMap((label) => {
      if (!label || typeof label !== "object") return [];
      const name = textOf((label as { name?: unknown }).name);
      if (!name) return [];
      return [{ name, color: textOf((label as { color?: unknown }).color) || "#bec2c8" }];
    }),
    team: teamKey && teamName ? { key: teamKey, name: teamName, color: colorOf(team?.color) } : null,
  };
}

export function parseComments(data: unknown): LinearComment[] {
  const issue = data && typeof data === "object" ? (data as { issue?: unknown }).issue : undefined;
  const comments = nodesOf(issue, "comments").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textOf(record.id);
    if (!id) return [];
    const user = record.user && typeof record.user === "object" ? textOf((record.user as { name?: unknown }).name) : "";
    return [{ id, body: textOf(record.body), createdAt: textOf(record.createdAt), author: user || null }];
  });
  return comments.sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""));
}

const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"];

function personName(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return textOf((value as { name?: unknown }).name);
}

function priorityName(value: unknown): string {
  return typeof value === "number" && value >= 0 && value < PRIORITY_NAMES.length ? PRIORITY_NAMES[value] ?? "" : "";
}

export function parseHistory(data: unknown): LinearChange[] {
  const issue = data && typeof data === "object" ? (data as { issue?: unknown }).issue : undefined;
  const record = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
  const changes: LinearChange[] = [];
  const createdAt = textOf(record.createdAt);
  const issueId = textOf(record.id);
  if (createdAt && issueId) {
    const creator = personName(record.creator);
    changes.push({ id: `created:${issueId}`, createdAt, author: creator || null, text: "created the issue" });
  }
  for (const node of nodesOf(issue, "history")) {
    if (!node || typeof node !== "object") continue;
    const entry = node as Record<string, unknown>;
    const id = textOf(entry.id);
    if (!id) continue;
    const parts: string[] = [];
    const fromState = personName(entry.fromState);
    const toState = personName(entry.toState);
    if (fromState || toState) parts.push(fromState && toState ? `moved from ${fromState} to ${toState}` : toState ? `moved to ${toState}` : `left ${fromState}`);
    const toPriority = priorityName(entry.toPriority);
    if (toPriority) {
      const fromPriority = priorityName(entry.fromPriority);
      parts.push(fromPriority ? `set priority from ${fromPriority} to ${toPriority}` : `set priority to ${toPriority}`);
    }
    const fromAssignee = personName(entry.fromAssignee);
    const toAssignee = personName(entry.toAssignee);
    if (fromAssignee || toAssignee) parts.push(toAssignee ? `assigned to ${toAssignee}` : `unassigned ${fromAssignee}`);
    if (entry.updatedDescription === true) parts.push("updated the description");
    if (parts.length === 0) continue;
    const actor = personName(entry.actor);
    changes.push({ id, createdAt: textOf(entry.createdAt), author: actor || null, text: parts.join(", ") });
  }
  return changes.sort((left, right) => Date.parse(left.createdAt || "") - Date.parse(right.createdAt || ""));
}

export function parseWorkflowStates(data: unknown): LinearWorkflowState[] {
  const issue = data && typeof data === "object" ? (data as { issue?: unknown }).issue : undefined;
  const team = issue && typeof issue === "object" ? (issue as { team?: unknown }).team : undefined;
  const states = nodesOf(team, "states").flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textOf(record.id);
    const name = textOf(record.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      type: textOf(record.type) || "unstarted",
      color: textOf(record.color) || "#bec2c8",
      position: typeof record.position === "number" ? record.position : 0,
    }];
  });
  return states.sort((left, right) => left.position - right.position).map(({ position: _position, ...state }) => state);
}

export function parseCreatedIssue(data: unknown): string | null {
  const created = data && typeof data === "object" ? (data as { issueCreate?: unknown }).issueCreate : undefined;
  const issue = created && typeof created === "object" ? (created as { issue?: unknown }).issue : undefined;
  if (!issue || typeof issue !== "object") return null;
  const identifier = textOf((issue as { identifier?: unknown }).identifier);
  return identifier || null;
}

export function parseIssueNodes(data: unknown): LinearIssueRow[] {
  const nodes = data && typeof data === "object" ? (data as { issues?: { nodes?: unknown } }).issues?.nodes : undefined;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    const row = parseOne(node);
    return row ? [row] : [];
  });
}

export function parseIssueCard(data: unknown): LinearIssueRow | null {
  const issue = data && typeof data === "object" ? (data as { issue?: unknown }).issue : undefined;
  return parseOne(issue);
}
