import { randomBytes } from "node:crypto";

export const LINEAR_SCOPES = "read,write,initiative:read,initiative:write";
const AUTHORIZE = "https://linear.app/oauth/authorize";
const TOKEN = "https://api.linear.app/oauth/token";
export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
const STATE_MS = 10 * 60 * 1000;

export class LinearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearError";
  }
}

export interface LinearTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function redirectUri(appUrl: string, pluginId: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/api/v1/plugins/${pluginId}/http/callback`;
}

export function newState(): string {
  return randomBytes(32).toString("hex");
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LINEAR_SCOPES);
  url.searchParams.set("state", args.state);
  url.searchParams.set("actor", "app");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function stateIsFresh(saved: { state: string; at: number } | null, given: string | null, now: number): boolean {
  if (!saved || !given || saved.state !== given) return false;
  return now - saved.at >= 0 && now - saved.at <= STATE_MS;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function readTokens(response: Response, now: number): Promise<LinearTokens> {
  if (!response.ok) throw new LinearError(`Linear refused the connection (HTTP ${response.status}).`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new LinearError("Linear returned no connection.");
  const record = body as Record<string, unknown>;
  const accessToken = record.access_token;
  const refreshToken = record.refresh_token;
  const expiresIn = record.expires_in;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string" || typeof expiresIn !== "number") {
    throw new LinearError("Linear returned no connection.");
  }
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000 };
}

export async function exchangeCode(fetchImpl: typeof fetch, args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  now?: number;
}): Promise<LinearTokens> {
  const response = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  return readTokens(response, args.now ?? Date.now());
}

export async function refreshTokens(fetchImpl: typeof fetch, args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now?: number;
}): Promise<LinearTokens> {
  const response = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  return readTokens(response, args.now ?? Date.now());
}

export async function linearGraphql(fetchImpl: typeof fetch, args: {
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<unknown> {
  const response = await fetchImpl(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
  });
  if (response.status === 401) throw new LinearError("Linear needs the connection again.");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok && (!body || typeof body !== "object" || !Array.isArray((body as { errors?: unknown }).errors))) {
    throw new LinearError(`Linear refused the query (HTTP ${response.status}).`);
  }
  if (!body || typeof body !== "object") throw new LinearError("Linear returned no data.");
  const errors = (body as { errors?: Array<{ message?: string }> }).errors;
  if (errors && errors.length > 0) {
    const message = errors.map((error) => error.message ?? "Linear refused the query.").join("; ");
    throw new LinearError(message.slice(0, 500));
  }
  return (body as { data?: unknown }).data ?? null;
}

export const queries = {
  teams: `query { teams(first: 50) { nodes { id key name } } }`,
  sidebar: `query { organization { name } teams(first: 50) { nodes { id key name color parent { id } } } initiatives(first: 50) { nodes { id name icon color } } projects(first: 50) { nodes { id name icon color state teams { nodes { id } } } } }`,
  projectRecord: `query($name: String!) { projects(first: 1, filter: { name: { eq: $name } }) { nodes { name description content icon color progress lead { name } startDate targetDate projectMilestones(first: 20) { nodes { id name progress targetDate } } documents(first: 20) { nodes { id title icon content } } } } }`,
  initiativeRecord: `query($id: String!) { initiative(id: $id) { name description content icon color documents(first: 20) { nodes { id title icon content } } projects(first: 50) { nodes { id name icon color state } } } }`,
  initiatives: `query { initiatives(first: 50) { nodes { id name description status } } }`,
  projects: `query($initiativeId: ID) { projects(first: 50, filter: { initiatives: { id: { eq: $initiativeId } } }) { nodes { id name description url state } } }`,
  projectsAll: `query { projects(first: 50) { nodes { id name description url state } } }`,
  issues: `query($projectId: ID) { issues(first: 50, filter: { project: { id: { eq: $projectId } } }) { nodes { id identifier title url state { name } project { id name } } } }`,
  issuesByTeam: `query($teamKey: String!) { issues(first: 25, orderBy: updatedAt, filter: { team: { key: { eq: $teamKey } } }) { nodes { id identifier title url priority priorityLabel updatedAt state { name type color } project { name } assignee { name } labels { nodes { name color } } } } }`,
  issuesAll: `query { issues(first: 25) { nodes { id identifier title url state { name } project { id name } } } }`,
  board: `query { issues(first: 50, orderBy: updatedAt) { nodes { id identifier title url priority priorityLabel state { name type color } project { name } assignee { name } labels { nodes { name color } } } } }`,
  card: `query($id: String!) { issue(id: $id) { id identifier title description url priority priorityLabel createdAt updatedAt dueDate estimate creator { name } state { id name type color } project { name icon color } projectMilestone { name } assignee { id name } parent { identifier title state { name type color } } children(first: 20) { nodes { id identifier title state { name type color } } } relations(first: 20) { nodes { id type relatedIssue { identifier title state { name type color } } } } inverseRelations(first: 20) { nodes { id type issue { identifier title state { name type color } } } } team { key name color states { nodes { id name type color position } } } labels { nodes { name color } } history(first: 50) { nodes { id createdAt updatedDescription actor { name } fromState { name } toState { name } fromPriority toPriority fromAssignee { name } toAssignee { name } } } comments(first: 50) { nodes { id body createdAt user { name } } } } }`,
  issue: `query($id: String!) { issue(id: $id) { id identifier title description url state { name } project { id name } team { id key name } } }`,
  createIssue: `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`,
  updateIssue: `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title url } } }`,
  comment: `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`,
  users: `query { users(first: 80) { nodes { id name active } } }`,
};

const ISSUE_FIELDS = "id identifier title url priority priorityLabel createdAt updatedAt dueDate estimate state { name type color } project { name icon color } assignee { id name } labels { nodes { name color } }";

export function scopedIssuesQuery(scope: "workspace" | "team" | "initiative", includeDone: boolean): string {
  const open = `state: { type: { nin: ["completed", "canceled"] } }`;
  let args = "";
  let filter = "";
  if (scope === "team") {
    args = "($teamKey: String!)";
    filter = includeDone ? "team: { key: { eq: $teamKey } }" : `team: { key: { eq: $teamKey } }, ${open}`;
  } else if (scope === "initiative") {
    args = "($initiativeId: ID!)";
    filter = includeDone
      ? "project: { initiatives: { id: { eq: $initiativeId } } }"
      : `project: { initiatives: { id: { eq: $initiativeId } } }, ${open}`;
  } else if (!includeDone) {
    filter = open;
  }
  const clause = filter ? `, filter: { ${filter} }` : "";
  return `query${args} { issues(first: 50, orderBy: updatedAt${clause}) { nodes { ${ISSUE_FIELDS} } } }`;
}
