import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  LinearError,
  authorizeUrl,
  exchangeCode,
  linearGraphql,
  newState,
  queries,
  redirectUri,
  scopedIssuesQuery,
  refreshTokens,
  stateIsFresh,
  type LinearTokens,
} from "./linear.js";
import { openWork, parseComments, parseCreatedIssue, parseDirectory, parseHistory, parseIssueCard, parseIssueNodes, parseRecord, parseRelations, parseUsers, parseWorkflowStates } from "./cards.js";
import { agentFromTimeline, matchByName, seatOf } from "./seat.js";
import { readConnection, writeConnection, type ConnectionFile } from "./connection.js";

const issueRow = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  description: z.string(),
  priority: z.number(),
  priorityLabel: z.string(),
  state: z.object({ id: z.string(), name: z.string(), type: z.string(), color: z.string() }).strict(),
  project: z.string().nullable(),
  projectIcon: z.string(),
  projectColor: z.string(),
  assignee: z.string().nullable(),
  assigneeId: z.string(),
  labels: z.array(z.object({ name: z.string(), color: z.string() }).strict()),
  createdAt: z.string(),
  updatedAt: z.string(),
  dueDate: z.string(),
  milestone: z.string(),
  estimate: z.number().nullable(),
  team: z.object({ key: z.string(), name: z.string(), color: z.string() }).strict().nullable(),
}).strict();

export const linearRpc = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({
      connected: z.boolean(),
      redirectUri: z.string().nullable(),
      appUrl: z.string().nullable(),
      credentialsReady: z.boolean(),
      clientId: z.string(),
    }).strict(),
  },
  saveCredentials: {
    input: z.object({ clientId: z.string(), clientSecret: z.string() }).strict(),
    output: z.object({ credentialsReady: z.boolean(), clientId: z.string() }).strict(),
  },
  connectUrl: {
    input: z.null(),
    output: z.object({ url: z.string() }).strict(),
  },
  disconnect: {
    input: z.null(),
    output: z.object({ connected: z.boolean() }).strict(),
  },
  board: {
    input: z.object({
      threadId: z.string().nullable(),
      includeDone: z.boolean(),
      teamKey: z.string().nullable(),
      initiativeId: z.string().nullable(),
    }).strict(),
    output: z.object({
      scope: z.enum(["workspace", "team", "initiative", "unmatched"]),
      title: z.string(),
      detail: z.string(),
      issues: z.array(issueRow),
    }).strict(),
  },
  card: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({
      issue: issueRow.nullable(),
      comments: z.array(z.object({
        id: z.string(),
        body: z.string(),
        createdAt: z.string(),
        author: z.string().nullable(),
      }).strict()),
      history: z.array(z.object({
        id: z.string(),
        createdAt: z.string(),
        author: z.string().nullable(),
        text: z.string(),
      }).strict()),
      parent: z.object({
        identifier: z.string(),
        title: z.string(),
        state: z.object({ name: z.string(), type: z.string(), color: z.string() }).strict(),
      }).strict().nullable(),
      children: z.array(z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        state: z.object({ name: z.string(), type: z.string(), color: z.string() }).strict(),
      }).strict()),
      links: z.array(z.object({
        id: z.string(),
        label: z.string(),
        identifier: z.string(),
        title: z.string(),
        state: z.object({ name: z.string(), type: z.string(), color: z.string() }).strict(),
      }).strict()),
      states: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        color: z.string(),
      }).strict()),
    }).strict(),
  },
  addComment: {
    input: z.object({ issueId: z.string().min(1), body: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  setStatus: {
    input: z.object({ id: z.string().min(1), stateId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  setPriority: {
    input: z.object({ id: z.string().min(1), priority: z.number().int().min(0).max(4) }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  setAssignee: {
    input: z.object({ id: z.string().min(1), assigneeId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  members: {
    input: z.null(),
    output: z.object({
      users: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    }).strict(),
  },
  createIssue: {
    input: z.object({
      title: z.string().min(1),
      teamId: z.string().min(1),
      description: z.string(),
      priority: z.number().int().min(0).max(4),
    }).strict(),
    output: z.object({ identifier: z.string() }).strict(),
  },
  record: {
    input: z.object({ project: z.string().nullable(), initiativeId: z.string().nullable() }).strict(),
    output: z.object({
      title: z.string(),
      summary: z.string(),
      content: z.string(),
      icon: z.string(),
      color: z.string(),
      documents: z.array(z.object({
        id: z.string(),
        title: z.string(),
        icon: z.string(),
        content: z.string(),
      }).strict()),
      projects: z.array(z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        color: z.string(),
        state: z.string(),
      }).strict()),
      lead: z.string(),
      startDate: z.string(),
      targetDate: z.string(),
      progress: z.number().nullable(),
      milestones: z.array(z.object({
        id: z.string(),
        name: z.string(),
        progress: z.number(),
        targetDate: z.string(),
      }).strict()),
    }).strict(),
  },
  directory: {
    input: z.null(),
    output: z.object({
      workspace: z.string(),
      teams: z.array(z.object({
        id: z.string(),
        key: z.string(),
        name: z.string(),
        color: z.string(),
        parentId: z.string().nullable(),
      }).strict()),
      initiatives: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string(), color: z.string() }).strict()),
      projects: z.array(z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        color: z.string(),
        state: z.string(),
        teamIds: z.array(z.string()),
      }).strict()),
    }).strict(),
  },
  overview: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({
        kind: z.literal("unmatched"),
        seat: z.string(),
        rank: z.enum(["vp", "pm", "head"]),
        area: z.string(),
      }).strict(),
      z.object({
        kind: z.literal("error"),
        seat: z.string(),
        message: z.string(),
      }).strict(),
      z.object({
        kind: z.literal("initiative"),
        seat: z.string(),
        name: z.string(),
        status: z.string(),
        projects: z.array(z.object({ id: z.string(), name: z.string(), state: z.string() }).strict()),
      }).strict(),
      z.object({
        kind: z.literal("team"),
        seat: z.string(),
        name: z.string(),
        key: z.string(),
        issues: z.array(issueRow),
      }).strict(),
    ]),
  },
});

const TOOLS = [
  "linear_teams",
  "linear_initiatives",
  "linear_projects",
  "linear_issues",
  "linear_issue",
  "linear_create_issue",
  "linear_update_issue",
  "linear_comment",
] as const;

function text(value: unknown): string {
  return JSON.stringify(value);
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function named(data: unknown, field: string): Array<{ id: string; name: string; key?: string; status?: string; state?: string }> {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>)[field] : undefined;
  const nodes = root && typeof root === "object" ? (root as { nodes?: unknown }).nodes : undefined;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const id = textField(record.id);
    const name = textField(record.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      ...(typeof record.key === "string" ? { key: record.key } : {}),
      ...(typeof record.status === "string" ? { status: record.status } : {}),
      ...(typeof record.state === "string" ? { state: record.state } : {}),
    }];
  });
}

function failure(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerCompanyLinear(bb: BbPluginApi, connectionFile: ConnectionFile = {}): void {
  const settings = bb.settings.define({
    clientId: {
      type: "string",
      label: "Linear client id",
      description: "From the Linear OAuth application. The redirect URI shown in Linear must match the one on the Linear page.",
    },
    clientSecret: {
      type: "string",
      label: "Linear client secret",
      description: "Stored on this server only. It is not written into the company directory.",
      secret: true,
    },
  });

  let cached: LinearTokens | null = null;

  async function credentials(): Promise<{ clientId: string; clientSecret: string }> {
    const values = await settings.get();
    const clientId = values.clientId
      || process.env.BOLTRIG_LINEAR_CLIENT_ID
      || process.env.OPENCHAMBER_LINEAR_CLIENT_ID
      || "";
    const clientSecret = values.clientSecret
      || process.env.BOLTRIG_LINEAR_CLIENT_SECRET
      || process.env.OPENCHAMBER_LINEAR_CLIENT_SECRET
      || "";
    if (!clientId || !clientSecret) {
      throw new LinearError("Add the Linear OAuth client id and secret, then connect.");
    }
    return { clientId, clientSecret };
  }

  function appUrl(): string {
    const url = bb.server.experimental_appUrl;
    if (!url) throw new LinearError("Set BB_APP_URL to the address people open this app on, then connect Linear.");
    return url;
  }

  async function accessToken(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expiresAt > now + 60_000) return cached.accessToken;
    const stored = cached ?? await readConnection(connectionFile.file);
    if (!stored) throw new LinearError("Linear is not connected. A person connects it from the Linear page.");
    const creds = await credentials();
    cached = await refreshTokens(fetch, { ...creds, refreshToken: stored.refreshToken, now });
    await writeConnection(cached, connectionFile.file);
    return cached.accessToken;
  }

  async function query(queryText: string, variables?: Record<string, unknown>): Promise<unknown> {
    const token = await accessToken();
    try {
      return await linearGraphql(fetch, { accessToken: token, query: queryText, variables });
    } catch (error) {
      if (!(error instanceof LinearError) || !error.message.includes("needs the connection")) throw error;
      cached = null;
      const again = await accessToken();
      return linearGraphql(fetch, { accessToken: again, query: queryText, variables });
    }
  }

  bb.rpc.register(linearRpc, {
    status: async () => {
      const values = await settings.get();
      const clientId = values.clientId
        || process.env.BOLTRIG_LINEAR_CLIENT_ID
        || process.env.OPENCHAMBER_LINEAR_CLIENT_ID
        || "";
      const clientSecret = values.clientSecret
        || process.env.BOLTRIG_LINEAR_CLIENT_SECRET
        || process.env.OPENCHAMBER_LINEAR_CLIENT_SECRET
        || "";
      const url = bb.server.experimental_appUrl;
      const stored = await readConnection(connectionFile.file);
      return {
        connected: Boolean(stored),
        redirectUri: url ? redirectUri(url, bb.pluginId) : null,
        appUrl: url,
        credentialsReady: Boolean(clientId && clientSecret),
        clientId,
      };
    },
    saveCredentials: async ({ clientId, clientSecret }) => {
      const id = clientId.trim();
      const secret = clientSecret.trim();
      if (!id) throw new LinearError("Add the client id.");
      const current = await settings.get();
      const keptSecret = secret
        || current.clientSecret
        || process.env.BOLTRIG_LINEAR_CLIENT_SECRET
        || process.env.OPENCHAMBER_LINEAR_CLIENT_SECRET
        || "";
      if (!keptSecret) throw new LinearError("Add the client secret.");
      const next: { clientId: string; clientSecret?: string } = { clientId: id };
      if (secret) next.clientSecret = secret;
      await settings.experimental_set(next);
      return { credentialsReady: true, clientId: id };
    },
    connectUrl: async () => {
      const creds = await credentials();
      const back = redirectUri(appUrl(), bb.pluginId);
      const state = newState();
      await bb.storage.kv.set("oauth-state", { state, at: Date.now() });
      return { url: authorizeUrl({ clientId: creds.clientId, redirectUri: back, state }) };
    },
    disconnect: async () => {
      cached = null;
      await writeConnection(null, connectionFile.file);
      return { connected: false };
    },
    board: async ({ threadId, includeDone, teamKey, initiativeId }) => {
      if (teamKey) {
        const teams = named(await query(queries.teams), "teams");
        const team = teams.find((item) => item.key === teamKey);
        if (!team?.key) return { scope: "unmatched" as const, title: "Linear", detail: `No team ${teamKey}.`, issues: [] };
        return {
          scope: "team" as const,
          title: team.name,
          detail: team.key,
          issues: parseIssueNodes(await query(scopedIssuesQuery("team", includeDone), { teamKey })),
        };
      }
      if (initiativeId) {
        const initiatives = named(await query(queries.initiatives), "initiatives");
        const initiative = initiatives.find((item) => item.id === initiativeId);
        if (!initiative) return { scope: "unmatched" as const, title: "Linear", detail: "No initiative matches.", issues: [] };
        return {
          scope: "initiative" as const,
          title: initiative.name,
          detail: textField(initiative.status),
          issues: parseIssueNodes(await query(scopedIssuesQuery("initiative", includeDone), { initiativeId })),
        };
      }
      let scope: "workspace" | "team" | "initiative" = "workspace";
      let title = "My issues";
      let detail = "";
      let queryText = scopedIssuesQuery("workspace", includeDone);
      let variables: Record<string, unknown> | undefined;
      if (threadId) {
        const timeline = await bb.sdk.threads.timeline({ threadId, summaryOnly: "true", segmentLimit: "1" });
        const seat = seatOf(agentFromTimeline(timeline));
        if (seat?.rank === "pm" || seat?.rank === "head") {
          const team = matchByName(seat.area, named(await query(queries.teams), "teams"));
          const teamKey = textField(team?.key);
          if (!team || !teamKey) return { scope: "unmatched" as const, title: "Linear", detail: `No team matches ${seat.area}.`, issues: [] };
          scope = "team";
          title = team.name;
          detail = teamKey;
          queryText = scopedIssuesQuery("team", includeDone);
          variables = { teamKey };
        } else if (seat?.rank === "vp") {
          const initiative = matchByName(seat.area, named(await query(queries.initiatives), "initiatives"));
          if (!initiative) return { scope: "unmatched" as const, title: "Linear", detail: `No initiative matches ${seat.area}.`, issues: [] };
          scope = "initiative";
          title = initiative.name;
          detail = textField(initiative.status);
          queryText = scopedIssuesQuery("initiative", includeDone);
          variables = { initiativeId: initiative.id };
        }
      }
      return { scope, title, detail, issues: parseIssueNodes(await query(queryText, variables)) };
    },
    record: async ({ project, initiativeId }) => {
      if (project) return parseRecord(await query(queries.projectRecord, { name: project }), "project");
      if (initiativeId) return parseRecord(await query(queries.initiativeRecord, { id: initiativeId }), "initiative");
      return { title: "", summary: "", content: "", icon: "", color: "", documents: [], projects: [], lead: "", startDate: "", targetDate: "", progress: null, milestones: [] };
    },
    directory: async () => parseDirectory(await query(queries.sidebar)),
    card: async ({ id }) => {
      const data = await query(queries.card, { id });
      const relations = parseRelations(data);
      return { issue: parseIssueCard(data), comments: parseComments(data), history: parseHistory(data), states: parseWorkflowStates(data), parent: relations.parent, children: relations.children, links: relations.links };
    },
    addComment: async ({ issueId, body }) => {
      await query(queries.comment, { input: { issueId, body } });
      return { ok: true };
    },
    setStatus: async ({ id, stateId }) => {
      await query(queries.updateIssue, { id, input: { stateId } });
      return { ok: true };
    },
    setPriority: async ({ id, priority }) => {
      await query(queries.updateIssue, { id, input: { priority } });
      return { ok: true };
    },
    setAssignee: async ({ id, assigneeId }) => {
      await query(queries.updateIssue, { id, input: { assigneeId } });
      return { ok: true };
    },
    members: async () => ({ users: parseUsers(await query(queries.users, {})) }),
    createIssue: async ({ title, teamId, description, priority }) => {
      const input: { title: string; teamId: string; priority: number; description?: string } = { title, teamId, priority };
      if (description.trim()) input.description = description.trim();
      const identifier = parseCreatedIssue(await query(queries.createIssue, { input }));
      if (!identifier) throw new LinearError("Linear did not return the new issue.");
      return { identifier };
    },
    overview: async ({ threadId }) => {
      const timeline = await bb.sdk.threads.timeline({ threadId, summaryOnly: "true", segmentLimit: "1" });
      const seat = seatOf(agentFromTimeline(timeline));
      if (!seat) return { kind: "none" as const };
      const seatId = `${seat.rank}-${seat.area}`;
      try {
        if (seat.rank === "vp") {
          const data = await query(queries.initiatives);
          const initiative = matchByName(seat.area, named(data, "initiatives"));
          if (!initiative) return { kind: "unmatched" as const, seat: seatId, rank: seat.rank, area: seat.area };
          const projects = await query(queries.projects, { initiativeId: initiative.id });
          return {
            kind: "initiative" as const,
            seat: seatId,
            name: initiative.name,
            status: textField(initiative.status),
            projects: named(projects, "projects").map((project) => ({
              id: project.id,
              name: project.name,
              state: textField(project.state),
            })),
          };
        }
        const data = await query(queries.teams);
        const team = matchByName(seat.area, named(data, "teams"));
        const teamKey = textField(team?.key);
        if (!team || !teamKey) return { kind: "unmatched" as const, seat: seatId, rank: seat.rank, area: seat.area };
        const issues = openWork(parseIssueNodes(await query(queries.issuesByTeam, { teamKey }))).slice(0, 8);
        return { kind: "team" as const, seat: seatId, name: team.name, key: textField(team.key), issues };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Linear did not answer.";
        return { kind: "error" as const, seat: seatId, message };
      }
    },
  });

  bb.http.route("GET", "/callback", async (context) => {
    const url = new URL(context.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const saved = await bb.storage.kv.get<{ state: string; at: number }>("oauth-state");
    await bb.storage.kv.delete("oauth-state");
    const page = (message: string) => new Response(`<!doctype html><title>Linear</title><p>${message.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char))}</p>`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    if (!code || !stateIsFresh(saved ?? null, state, Date.now())) {
      return page("Linear was not connected. Start again from the Linear page.");
    }
    try {
      const creds = await credentials();
      const tokens = await exchangeCode(fetch, {
        ...creds,
        code,
        redirectUri: redirectUri(appUrl(), bb.pluginId),
      });
      cached = tokens;
      await writeConnection(tokens, connectionFile.file);
      return page("Linear is connected. You can close this tab and return to the app.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Linear was not connected.";
      return page(message);
    }
  }, { auth: "none" });

  const instructions = "A VP is a Linear initiative. A PM heads one Linear team. Read before you write. The company directory holds no Linear token.";

  bb.agents.configure(() => ({ tools: [...TOOLS], skills: [], instructions }));

  bb.agents.registerTool({
    name: "linear_teams",
    description: "List Linear teams. A PM heads one team.",
    instructions,
    parameters: z.object({}).strict(),
    async execute() {
      try { return text(await query(queries.teams)); } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_initiatives",
    description: "List Linear initiatives. Each initiative is a VP.",
    instructions,
    parameters: z.object({}).strict(),
    async execute() {
      try { return text(await query(queries.initiatives)); } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_projects",
    description: "List Linear projects. Pass an initiative id to list one VP's projects.",
    instructions,
    parameters: z.object({ initiativeId: z.string().optional() }).strict(),
    async execute(input) {
      try {
        return text(input.initiativeId
          ? await query(queries.projects, { initiativeId: input.initiativeId })
          : await query(queries.projectsAll));
      } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_issues",
    description: "List Linear issues, optionally for one PM's project id.",
    instructions,
    parameters: z.object({ projectId: z.string().optional() }).strict(),
    async execute(input) {
      try {
        return text(input.projectId
          ? await query(queries.issues, { projectId: input.projectId })
          : await query(queries.issuesAll));
      } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_issue",
    description: "Read one Linear issue by id or identifier.",
    instructions,
    parameters: z.object({ id: z.string().min(1) }).strict(),
    async execute(input) {
      try { return text(await query(queries.issue, { id: input.id })); } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_create_issue",
    description: "Create a Linear issue in a team, optionally on a PM's project.",
    instructions,
    parameters: z.object({
      title: z.string().min(1),
      teamId: z.string().min(1),
      description: z.string().optional(),
      projectId: z.string().optional(),
    }).strict(),
    async execute(input) {
      try { return text(await query(queries.createIssue, { input })); } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_update_issue",
    description: "Update a Linear issue's title, description, state or project.",
    instructions,
    parameters: z.object({
      id: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      stateId: z.string().optional(),
      projectId: z.string().optional(),
    }).strict(),
    async execute(input) {
      const { id, ...rest } = input;
      try { return text(await query(queries.updateIssue, { id, input: rest })); } catch (error) { return failure(error); }
    },
  });
  bb.agents.registerTool({
    name: "linear_comment",
    description: "Add a comment to a Linear issue.",
    instructions,
    parameters: z.object({ issueId: z.string().min(1), body: z.string().min(1) }).strict(),
    async execute(input) {
      try { return text(await query(queries.comment, { input })); } catch (error) { return failure(error); }
    },
  });
}

export default function companyLinearPlugin(bb: BbPluginApi): void {
  registerCompanyLinear(bb);
}
