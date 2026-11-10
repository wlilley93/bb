import { describe, expect, it } from "vitest";
import { agentFromTimeline, matchByName, seatOf } from "./seat.js";

describe("seat", () => {
  it("reads a vp or pm from the thread mode and ignores other agents", () => {
    expect(seatOf("vp-projects")).toEqual({ rank: "vp", area: "projects" });
    expect(seatOf("pm-agent-ops")).toEqual({ rank: "pm", area: "agent-ops" });
    expect(seatOf("head-projects")).toEqual({ rank: "head", area: "projects" });
    expect(seatOf("build")).toBeNull();
    expect(seatOf("vp")).toBeNull();
    expect(seatOf("head")).toBeNull();
  });

  it("reads the mode from a thread timeline", () => {
    expect(agentFromTimeline({ sessionOptions: [{ id: "mode", type: "select", value: "vp-delivery" }] })).toBe("vp-delivery");
    expect(agentFromTimeline({ sessionOptions: [{ id: "mode", type: "select", value: "build", pendingValue: "pm-projects" }] })).toBe("pm-projects");
    expect(agentFromTimeline({ sessionOptions: [{ id: "web", type: "boolean", value: true }] })).toBeNull();
    expect(agentFromTimeline(null)).toBeNull();
  });

  it("matches an area to the closest initiative or team name", () => {
    const teams = [
      { name: "Personal Operations" },
      { name: "Projects" },
      { name: "Agent Operations" },
      { name: "Delivery" },
      { name: "Research" },
      { name: "Engineering" },
    ];
    expect(matchByName("projects", teams)?.name).toBe("Projects");
    expect(matchByName("agent-ops", teams)?.name).toBe("Agent Operations");
    expect(matchByName("personal-ops", teams)?.name).toBe("Personal Operations");
    expect(matchByName("delivery", teams)?.name).toBe("Delivery");
    expect(matchByName("research", [{ name: "Client Research" }, { name: "Research" }])?.name).toBe("Research");
    expect(matchByName("family-ops", teams)).toBeNull();
    expect(matchByName("projects", [{ name: "Boltrig Projects" }])).toBeNull();
  });
});
