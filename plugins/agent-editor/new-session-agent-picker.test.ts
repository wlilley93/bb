import { describe, expect, it } from "vitest";
import {
  buildGroups,
  filterGroups,
  flatten,
  isSidebarSelection,
  needsSearch,
  parseFolders,
  parseSeats,
  resolveCurrent,
  roleLabel,
  stepIndex,
  visibleGroups,
} from "./new-session-agent-picker-model.js";

const seats = [
  { id: "head-delivery", tier: "head" },
  { id: "head-research", tier: "head" },
  { id: "vp-delivery", tier: "vp" },
  { id: "pm-delivery", tier: "pm" },
  { id: "pm-research", tier: "pm" },
  { id: "vp", tier: "vp" },
];

const folders = [
  { path: "/h/Delivery", name: "Delivery", seat: "head-delivery", tier: "head" },
  { path: "/h/Delivery/Bayer", name: "Bayer", seat: "vp-delivery", tier: "vp" },
  { path: "/h/Delivery/Bayer/ops", name: "ops", seat: "pm-delivery", tier: "pm" },
  { path: "/h/Research", name: "Research", seat: "head-research", tier: "head" },
  { path: "/h/Research/ai", name: "ai", seat: "pm-research", tier: "pm" },
  { path: "/h/Stray", name: "Stray", seat: "vp", tier: "vp" },
];

describe("buildGroups", () => {
  const groups = buildGroups(seats, folders);

  it("groups every head with the folders under it, in sidebar order", () => {
    expect(groups.map((group) => group.headKey)).toEqual(["/h/Delivery", "/h/Research"]);
    expect(groups[0]?.entries.map((entry) => [entry.name, entry.depth, entry.role])).toEqual([
      ["Delivery", 0, "Head of Delivery"],
      ["Bayer", 1, "VP"],
      ["ops", 2, "PM"],
    ]);
    expect(groups[1]?.entries.map((entry) => entry.name)).toEqual(["Research", "ai"]);
  });

  it("records the ancestors a collapsed row needs opened", () => {
    const ops = flatten(groups).find((entry) => entry.name === "ops");
    expect(ops?.ancestors).toEqual(["/h/Delivery", "/h/Delivery/Bayer"]);
    expect(ops?.headKey).toBe("/h/Delivery");
  });

  it("leaves the bare vp and pm seats and unhomed seats out", () => {
    expect(flatten(groups).some((entry) => entry.seatId === "vp")).toBe(false);
    expect(buildGroups(seats, [])).toEqual([]);
  });
});

describe("roleLabel", () => {
  it("labels heads, VPs and PMs as the sidebar does", () => {
    expect(roleLabel({ id: "head-family-ops", tier: "head" })).toBe("Head of Family Ops");
    expect(roleLabel({ id: "vp-research", tier: "vp" })).toBe("VP");
    expect(roleLabel({ id: "pm-research", tier: "pm" })).toBe("PM");
  });
});

describe("filtering", () => {
  const groups = buildGroups(seats, folders);

  it("keeps matching entries and drops empty groups", () => {
    const hit = filterGroups(groups, "bayer");
    expect(hit).toHaveLength(1);
    expect(hit[0]?.entries.map((entry) => entry.name)).toEqual(["Bayer"]);
  });

  it("matches the role and the seat id", () => {
    expect(flatten(filterGroups(groups, "pm")).map((entry) => entry.name)).toEqual(["ops", "ai"]);
    expect(flatten(filterGroups(groups, "pm-research")).map((entry) => entry.name)).toEqual(["ai"]);
  });

  it("returns everything for a blank query and nothing for a miss", () => {
    expect(flatten(filterGroups(groups, "  "))).toHaveLength(5);
    expect(filterGroups(groups, "zzz")).toEqual([]);
  });

  it("offers search only past eight rows", () => {
    expect(needsSearch(groups)).toBe(false);
    const many = Array.from({ length: 9 }, (_, index) => ({
      path: `/h/H${index}`,
      name: `H${index}`,
      seat: `head-h${index}`,
      tier: "head",
    }));
    expect(needsSearch(buildGroups(many.map((folder) => ({ id: folder.seat, tier: "head" })), many))).toBe(true);
  });
});

describe("visibleGroups", () => {
  const groups = buildGroups(seats, folders);

  it("shows all heads and only the open head's folders by default", () => {
    const shown = visibleGroups(groups, { currentKey: "/h/Delivery/Bayer", expanded: false, query: "" });
    expect(shown.map((group) => group.entries.length)).toEqual([3, 1]);
  });

  it("collapses every head when nothing is current", () => {
    const shown = visibleGroups(groups, { currentKey: null, expanded: false, query: "" });
    expect(shown.map((group) => group.entries.length)).toEqual([1, 1]);
  });

  it("shows everything when expanded or searching", () => {
    expect(flatten(visibleGroups(groups, { currentKey: null, expanded: true, query: "" }))).toHaveLength(5);
    expect(flatten(visibleGroups(groups, { currentKey: null, expanded: false, query: "ai" })).map((entry) => entry.name)).toEqual(["ai"]);
  });
});

describe("resolveCurrent", () => {
  const groups = buildGroups(seats, folders);

  it("prefers the active sidebar folder", () => {
    const current = resolveCurrent(groups, { activeFolder: "/h/Delivery/Bayer", activeSeat: "head-research", lastUsed: "/h/Research" });
    expect(current?.name).toBe("Bayer");
  });

  it("falls back to the active seat, then the last used row", () => {
    expect(resolveCurrent(groups, { activeFolder: null, activeSeat: "pm-research", lastUsed: "/h/Delivery" })?.name).toBe("ai");
    expect(resolveCurrent(groups, { activeFolder: null, activeSeat: null, lastUsed: "/h/Delivery" })?.name).toBe("Delivery");
  });

  it("ignores a stale folder that is no longer listed", () => {
    expect(resolveCurrent(groups, { activeFolder: "/gone", activeSeat: null, lastUsed: "/h/Research" })?.name).toBe("Research");
    expect(resolveCurrent(groups, { activeFolder: null, activeSeat: null, lastUsed: null })).toBeNull();
  });

  it("tells a sidebar selection from a remembered default", () => {
    const entries = flatten(groups);
    expect(isSidebarSelection({ activeFolder: null, activeSeat: "head-research", lastUsed: null }, entries)).toBe(true);
    expect(isSidebarSelection({ activeFolder: "/gone", activeSeat: "ghost", lastUsed: "/h/Research" }, entries)).toBe(false);
  });
});

describe("stepIndex", () => {
  it("clamps at both ends and starts from the right edge", () => {
    expect(stepIndex(-1, 1, 4)).toBe(0);
    expect(stepIndex(-1, -1, 4)).toBe(3);
    expect(stepIndex(3, 1, 4)).toBe(3);
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});

describe("rpc parsing", () => {
  it("accepts well-formed results and skips malformed rows", () => {
    expect(parseSeats({ ok: true, result: { seats: [{ id: "a", tier: "head" }, { id: 3 }] } })).toEqual([{ id: "a", tier: "head" }]);
    expect(parseFolders({ ok: true, result: { folders: [{ path: "/p", name: "p", seat: "a", tier: "head" }, { path: "/q" }] } })).toEqual([
      { path: "/p", name: "p", seat: "a", tier: "head" },
    ]);
  });

  it("rejects an error envelope", () => {
    expect(parseSeats({ ok: false, error: { code: "x" } })).toBeNull();
    expect(parseFolders("nope")).toBeNull();
  });
});
