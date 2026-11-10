import { describe, expect, it } from "vitest";
import { ageLabel } from "./cards.js";
import { parseDescription } from "./prose.js";

describe("description", () => {
  it("keeps headings, emphasis, lists and http links", () => {
    const blocks = parseDescription("## Goal\n\nLinear is the tracker.\n\n- **Client.** See [Linear](https://linear.app).\n- A `key` stays literal.\n");
    expect(blocks[0]).toEqual({ kind: "h", level: 2, inlines: [{ kind: "text", text: "Goal" }] });
    expect(blocks[1]).toEqual({ kind: "p", inlines: [{ kind: "text", text: "Linear is the tracker." }] });
    expect(blocks[2]).toMatchObject({ kind: "ul" });
    if (blocks[2]?.kind === "ul") {
      expect(blocks[2].items[0]?.[0]).toEqual({ kind: "strong", text: "Client." });
      expect(blocks[2].items[0]?.[2]).toEqual({ kind: "link", text: "Linear", href: "https://linear.app" });
      expect(blocks[2].items[1]?.[1]).toEqual({ kind: "code", text: "key" });
    }
  });

  it("drops a javascript link", () => {
    const blocks = parseDescription("[click](javascript:alert(1))");
    expect(blocks[0]).toEqual({ kind: "p", inlines: [{ kind: "text", text: "[click](javascript:alert(1))" }] });
  });

  it("reads a Linear autolink and a task box", () => {
    const blocks = parseDescription("See [PRJ-1](<https://linear.app/boltrig/issue/PRJ-1>) and <https://linear.app>.\n\n- [x] Shipped\n- [ ] Left");
    expect(blocks[0]).toEqual({
      kind: "p",
      inlines: [
        { kind: "text", text: "See " },
        { kind: "link", text: "PRJ-1", href: "https://linear.app/boltrig/issue/PRJ-1" },
        { kind: "text", text: " and " },
        { kind: "link", text: "https://linear.app", href: "https://linear.app" },
        { kind: "text", text: "." },
      ],
    });
    expect(blocks[1]).toEqual({
      kind: "ul",
      items: [
        [{ kind: "check", checked: true }, { kind: "text", text: "Shipped" }],
        [{ kind: "check", checked: false }, { kind: "text", text: "Left" }],
      ],
    });
  });

  it("links a bare issue identifier and leaves one inside a path or code span", () => {
    const blocks = parseDescription("See DEV-1384 and ticket/DEV-9, not `PRJ-1` or SHA-256.");
    expect(blocks[0]).toEqual({
      kind: "p",
      inlines: [
        { kind: "text", text: "See " },
        { kind: "issue", identifier: "DEV-1384" },
        { kind: "text", text: " and ticket/DEV-9, not " },
        { kind: "code", text: "PRJ-1" },
        { kind: "text", text: " or SHA-256." },
      ],
    });
  });
});

describe("age", () => {
  it("shortens an update time", () => {
    const now = Date.parse("2026-11-09T18:00:00Z");
    expect(ageLabel("2026-11-09T17:59:30Z", now)).toBe("now");
    expect(ageLabel("2026-11-09T17:12:00Z", now)).toBe("48m");
    expect(ageLabel("2026-11-09T15:00:00Z", now)).toBe("3h");
    expect(ageLabel("2026-11-06T18:00:00Z", now)).toBe("3d");
    expect(ageLabel("", now)).toBe("");
  });
});
