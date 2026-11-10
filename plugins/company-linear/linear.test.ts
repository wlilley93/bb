import { describe, expect, it } from "vitest";
import { byPriority, dayLabel, duePhrase, groupIssues, isOverdue, matchesQuery, openWork, parseComments, parseCreatedIssue, parseDirectory, parseHistory, parseIssueCard, parseIssueNodes, parseRecord, parseRelations, parseUsers, parseWorkflowStates, sidebarProjects } from "./cards.js";
import {
  authorizeUrl,
  exchangeCode,
  linearGraphql,
  queries,
  redirectUri,
  scopedIssuesQuery,
  stateIsFresh,
} from "./linear.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("linear oauth", () => {
  it("builds an app-actor authorize URL and a callback on this server", () => {
    const back = redirectUri("https://agents.example.com/", "company-linear");
    expect(back).toBe("https://agents.example.com/api/v1/plugins/company-linear/http/callback");
    const url = new URL(authorizeUrl({ clientId: "client", redirectUri: back, state: "state-1" }));
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("redirect_uri")).toBe(back);
    expect(url.searchParams.get("scope")).toBe("read,write,initiative:read,initiative:write");
    expect(url.searchParams.get("actor")).toBe("app");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("accepts a state once, inside ten minutes", () => {
    const now = 1_000_000;
    expect(stateIsFresh({ state: "abc", at: now }, "abc", now + 1000)).toBe(true);
    expect(stateIsFresh({ state: "abc", at: now }, "nope", now + 1000)).toBe(false);
    expect(stateIsFresh({ state: "abc", at: now }, "abc", now + 11 * 60 * 1000)).toBe(false);
    expect(stateIsFresh(null, "abc", now)).toBe(false);
  });

  it("exchanges a code and does not echo the token in an error", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return jsonResponse({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 });
    };
    const tokens = await exchangeCode(fetchImpl, {
      clientId: "client",
      clientSecret: "secret",
      code: "code-1",
      redirectUri: "https://agents.example.com/callback",
      now: 5_000,
    });
    expect(tokens.accessToken).toBe("access-secret");
    expect(tokens.refreshToken).toBe("refresh-secret");
    expect(tokens.expiresAt).toBe(5_000 + 3_600_000);
    expect(calls[0]?.url).toBe("https://api.linear.app/oauth/token");
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[0]?.body).toContain("client_secret=secret");
    const refused: typeof fetch = async () => jsonResponse({ error: "invalid_grant", access_token: "should-not-leak" }, 400);
    await expect(exchangeCode(refused, {
      clientId: "client",
      clientSecret: "secret",
      code: "bad",
      redirectUri: "https://agents.example.com/callback",
    })).rejects.toThrow("HTTP 400");
  });

  it("asks Linear for initiatives, projects and an issue write", async () => {
    let authorization = "";
    let query = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization = String(new Headers(init?.headers).get("authorization"));
      query = JSON.parse(String(init?.body)).query as string;
      return jsonResponse({ data: { initiatives: { nodes: [{ id: "i1", name: "Records" }] } } });
    };
    const data = await linearGraphql(fetchImpl, { accessToken: "access-secret", query: queries.initiatives });
    expect(authorization).toBe("Bearer access-secret");
    expect(query).toContain("initiatives");
    expect(data).toEqual({ initiatives: { nodes: [{ id: "i1", name: "Records" }] } });
    expect(queries.projects).toContain("initiativeId");
    expect(queries.createIssue).toContain("issueCreate");
    expect(queries.comment).toContain("commentCreate");
    expect(queries.board).toContain("priorityLabel");
    expect(queries.sidebar).toContain("organization");
    expect(queries.sidebar).toContain("parent");
    expect(queries.sidebar).toContain("color");
    expect(queries.sidebar).toContain("icon");
    expect(queries.projectRecord).toContain("documents");
    expect(queries.projectRecord).toContain("lead");
    expect(queries.projectRecord).toContain("projectMilestones");
    expect(queries.card).toContain("projectMilestone { name }");
    expect(queries.card).toContain("dueDate estimate");
    expect(queries.card).toContain("inverseRelations");
    expect(queries.initiativeRecord).toContain("content");
    expect(queries.card).toContain("comments");
    expect(queries.card).toContain("states");
    expect(queries.card).toContain("history");
    expect(queries.card).toContain("children");
    expect(queries.card).toContain("dueDate");
    expect(queries.card).toContain("parent { identifier title state { name type color } }");
    expect(queries.card).toContain("assignee { id name }");
    expect(queries.users).toContain("active");
    expect(queries.card).toContain("project { name icon color }");
    expect(queries.card).toContain("team { key name color");
    expect(scopedIssuesQuery("workspace", true)).toContain("project { name icon color }");
    expect(queries.initiativeRecord).toContain("projects(first: 50)");
    const team = scopedIssuesQuery("team", false);
    expect(team).toContain("team: { key: { eq: $teamKey } }");
    expect(team).toContain('nin: ["completed", "canceled"]');
    expect(scopedIssuesQuery("workspace", true)).not.toContain("filter:");
    expect(scopedIssuesQuery("initiative", false)).toContain("initiatives: { id: { eq: $initiativeId } }");
  });
});

describe("linear cards", () => {
  it("keeps a workflow state, and drops a node with no identifier", () => {
    const rows = parseIssueNodes({
      issues: {
        nodes: [
          { id: "1", identifier: "ENG-4", title: "Fix login", url: "https://linear.app/eng-4", priority: 2, priorityLabel: "High", state: { name: "In Progress", type: "started", color: "#f2c94c" }, project: { name: "Records" }, assignee: null, labels: { nodes: [{ name: "Bug", color: "#eb5757" }] } },
          { id: "2", title: "Missing id" },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ identifier: "ENG-4", state: { type: "started", color: "#f2c94c" }, project: "Records", projectIcon: "", projectColor: "#8A8F98", assignee: null, assigneeId: "", estimate: null, labels: [{ name: "Bug", color: "#eb5757" }] });
    expect(parseUsers({ users: { nodes: [{ id: "u2", name: "Bea", active: true }, { id: "u1", name: "Ada", active: true }, { id: "u3", name: "Gone", active: false }] } })).toEqual([{ id: "u1", name: "Ada" }, { id: "u2", name: "Bea" }]);
    expect(parseIssueCard({ issue: null })).toBeNull();
    expect(openWork([{ state: { type: "started" } }, { state: { type: "completed" } }, { state: { type: "canceled" } }, { state: { type: "backlog" } }])).toEqual([{ state: { type: "started" } }, { state: { type: "backlog" } }]);
    const issue = rows[0];
    if (!issue) throw new Error("expected a row");
    expect(matchesQuery(issue, "records")).toBe(true);
    expect(matchesQuery(issue, "bug")).toBe(true);
    expect(matchesQuery(issue, "ENG-4")).toBe(true);
    expect(matchesQuery(issue, "absent")).toBe(false);
    expect(matchesQuery(issue, "  ")).toBe(true);
  });

  it("reads the workspace, a parent team and the open projects", () => {
    const directory = parseDirectory({
      organization: { name: "Boltrig" },
      teams: {
        nodes: [
          { id: "t1", key: "PRJ", name: "Projects", color: "#4ea7fc", parent: null },
          { id: "t2", key: "REQ", name: "Requirements", color: "nope", parent: { id: "t1" } },
          { id: "t3", name: "No key" },
        ],
      },
      initiatives: { nodes: [{ id: "i1", name: "Internal" }, { name: "no id" }] },
      projects: {
        nodes: [
          { id: "p1", name: "Codex", state: "started", teams: { nodes: [{ id: "t1" }] } },
          { id: "p2", name: "Old", state: "completed", teams: { nodes: [] } },
        ],
      },
    });
    expect(directory.workspace).toBe("Boltrig");
    expect(directory.teams).toEqual([
      { id: "t1", key: "PRJ", name: "Projects", color: "#4ea7fc", parentId: null },
      { id: "t2", key: "REQ", name: "Requirements", color: "#5E6AD2", parentId: "t1" },
    ]);
    expect(directory.initiatives).toEqual([{ id: "i1", name: "Internal", icon: "", color: "#8A8F98" }]);
    expect(sidebarProjects(directory.projects)).toEqual([
      { id: "p1", name: "Codex", icon: "", color: "#8A8F98", state: "started", teamIds: ["t1"] },
    ]);
  });

  it("orders a group by priority, then by the latest update", () => {
    const rows = [
      { priority: 0, updatedAt: "2026-11-09T18:00:00Z" },
      { priority: 2, updatedAt: "2026-11-09T12:00:00Z" },
      { priority: 1, updatedAt: "2026-11-08T12:00:00Z" },
      { priority: 2, updatedAt: "2026-11-09T16:00:00Z" },
    ].sort(byPriority);
    expect(rows.map((row) => row.priority)).toEqual([1, 2, 2, 0]);
    expect(rows[1]?.updatedAt).toBe("2026-11-09T16:00:00Z");
  });

  it("groups by assignee and reads a project document", () => {
    const issue = {
      id: "1",
      identifier: "ENG-1",
      title: "Ship",
      url: "",
      description: "",
      priority: 2,
      priorityLabel: "High",
      state: { id: "", name: "Todo", type: "unstarted", color: "#bec2c8" },
      project: "Codex",
      assignee: null,
      labels: [],
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
      team: null,
    };
    const buckets = groupIssues([issue], "assignee", "title");
    expect(buckets).toEqual([{ id: "__none__", label: "Unassigned", rows: [issue] }]);
    expect(parseRecord({
      projects: { nodes: [{ name: "Codex", description: "Short", content: "The brief.", icon: "📦", color: "#4ea7fc", progress: 0.4, projectMilestones: { nodes: [{ id: "m1", name: "Alpha", progress: 0.5, targetDate: "2026-12-01" }, { name: "No id" }] } }] },
      documents: { nodes: [{ id: "d1", title: "Spec", icon: "", content: "Details." }, { title: "No id" }] },
    }, "project")).toEqual({
      title: "Codex",
      summary: "Short",
      content: "The brief.",
      icon: "📦",
      color: "#4ea7fc",
      documents: [{ id: "d1", title: "Spec", icon: "", content: "Details." }],
      projects: [],
      lead: "",
      startDate: "",
      targetDate: "",
      progress: 0.4,
      milestones: [{ id: "m1", name: "Alpha", progress: 0.5, targetDate: "2026-12-01" }],
    });
    expect(dayLabel("2026-11-09")).toBe("9 Nov 2026");
    const ninth = Date.UTC(2026, 10, 9);
    expect(duePhrase("2026-11-09", ninth)).toBe("Today");
    expect(duePhrase("2026-11-10", ninth)).toBe("Tomorrow");
    expect(duePhrase("2026-11-08", ninth)).toBe("Yesterday");
    expect(duePhrase("2026-12-01", ninth)).toBe("1 Dec");
    expect(duePhrase("2025-01-02", ninth)).toBe("2 Jan 2025");
    expect(duePhrase("", ninth)).toBe("");
    expect(dayLabel("")).toBe("");
    expect(parseRelations({
      issue: {
        parent: { identifier: "ENG-1", title: "Parent", state: { name: "In Progress", type: "started", color: "#f2c94c" } },
        children: { nodes: [{ id: "c1", identifier: "ENG-2", title: "Child", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } }, { title: "No id" }] },
        relations: { nodes: [{ id: "r1", type: "blocks", relatedIssue: { identifier: "ENG-3", title: "Later", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } } }] },
        inverseRelations: { nodes: [{ id: "r2", type: "blocks", issue: { identifier: "ENG-4", title: "Earlier", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } } }] },
      },
    })).toEqual({
      parent: { identifier: "ENG-1", title: "Parent", state: { name: "In Progress", type: "started", color: "#f2c94c" } },
      children: [{ id: "c1", identifier: "ENG-2", title: "Child", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } }],
      links: [
        { id: "r1", label: "Blocks", identifier: "ENG-3", title: "Later", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } },
        { id: "r2", label: "Blocked by", identifier: "ENG-4", title: "Earlier", state: { name: "Todo", type: "unstarted", color: "#bec2c8" } },
      ],
    });
    expect(isOverdue("2020-01-01", "started", Date.UTC(2026, 0, 2))).toBe(true);
    expect(isOverdue("2020-01-01", "completed", Date.UTC(2026, 0, 2))).toBe(false);
  });

  it("reads comments in the order they were written", () => {
    const comments = parseComments({
      issue: {
        comments: {
          nodes: [
            { id: "c2", body: "Later", createdAt: "2026-11-09T12:00:00Z", user: { name: "Will" } },
            { id: "c1", body: "First", createdAt: "2026-11-08T12:00:00Z", user: null },
            { body: "No id" },
          ],
        },
      },
    });
    expect(comments).toEqual([
      { id: "c1", body: "First", createdAt: "2026-11-08T12:00:00Z", author: null },
      { id: "c2", body: "Later", createdAt: "2026-11-09T12:00:00Z", author: "Will" },
    ]);
    expect(parseHistory({
      issue: {
        id: "1",
        createdAt: "2026-11-01T00:00:00Z",
        creator: { name: "Will" },
        history: {
          nodes: [
            { id: "h2", createdAt: "2026-11-03T00:00:00Z", actor: { name: "Will" }, fromPriority: 3, toPriority: 1, toAssignee: { name: "Ada" } },
            { id: "h1", createdAt: "2026-11-02T00:00:00Z", fromState: { name: "Todo" }, toState: { name: "In Progress" }, updatedDescription: true },
            { id: "h0", createdAt: "2026-11-02T01:00:00Z" },
          ],
        },
      },
    }).map((change) => change.text)).toEqual([
      "created the issue",
      "moved from Todo to In Progress, updated the description",
      "set priority from Medium to Urgent, assigned to Ada",
    ]);
    expect(parseIssueCard({
      issue: { id: "1", identifier: "ENG-4", title: "Fix login", team: { key: "ENG", name: "Engineering" }, state: { id: "st", name: "Todo", type: "unstarted", color: "#bec2c8" } },
    })).toMatchObject({ state: { id: "st" }, team: { key: "ENG", name: "Engineering", color: "#5E6AD2" }, projectIcon: "", projectColor: "" });
    expect(parseWorkflowStates({
      issue: {
        team: {
          states: {
            nodes: [
              { id: "b", name: "Todo", type: "unstarted", color: "#e2e2e2", position: 2 },
              { id: "a", name: "In Progress", type: "started", color: "#f2c94c", position: 1 },
              { name: "No id" },
            ],
          },
        },
      },
    })).toEqual([
      { id: "a", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "b", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ]);
    expect(parseCreatedIssue({ issueCreate: { issue: { identifier: "ENG-9" } } })).toBe("ENG-9");
    expect(parseCreatedIssue({ issueCreate: { issue: null } })).toBeNull();
  });
});
