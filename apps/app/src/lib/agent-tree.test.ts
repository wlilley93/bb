import { describe, expect, it } from "vitest";
import {
  agentTreeIds,
  publishedTreeForAgent,
  threadsInAgentTree,
} from "./agent-tree";

const seats = [
  "head-family-ops",
  "vp-family-ops",
  "pm-family-ops",
  "head-projects",
  "vp-boltrig",
  "pm-boltrig",
  "build",
];

describe("agentTreeIds", () => {
  it("keeps a head together with the seats that roll up to it", () => {
    expect([...agentTreeIds(seats, "head-family-ops")].sort()).toEqual([
      "head-family-ops",
      "pm-family-ops",
      "vp-family-ops",
    ]);
  });

  it("rolls a child seat up to that same head", () => {
    expect(agentTreeIds(seats, "pm-family-ops")).toEqual(
      new Set(["head-family-ops", "vp-family-ops", "pm-family-ops"]),
    );
  });

  it("uses the published folder tree when a seat's name does not match its head", () => {
    const tree = publishedTreeForAgent(
      [{ head: "head-projects", seats: ["head-projects", "vp-boltrig", "pm-boltrig"] }],
      "pm-boltrig",
    );
    expect(tree).toEqual(new Set(["head-projects", "vp-boltrig", "pm-boltrig"]));
  });

  it("leaves an unrelated mode as its own tree", () => {
    expect(agentTreeIds(seats, "build")).toEqual(new Set(["build"]));
  });
});

describe("threadsInAgentTree", () => {
  it("keeps threads whose agent sits in the current head's tree", () => {
    const threads = [
      { id: "thr_family" },
      { id: "thr_projects" },
      { id: "thr_unknown" },
    ];
    const kept = threadsInAgentTree(threads, {
      agentId: "head-family-ops",
      seatIds: seats,
      modeByThreadId: new Map([
        ["thr_family", "vp-family-ops"],
        ["thr_projects", "head-projects"],
        ["thr_unknown", null],
      ]),
    });
    expect(kept.map((thread) => thread.id)).toEqual(["thr_family"]);
  });
});
