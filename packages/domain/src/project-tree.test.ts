import assert from "node:assert/strict";
import { test } from "node:test";
import { orderSeatTree } from "./project-tree.ts";

test("a head holds its VP and that VP holds its PM", () => {
  const ordered = orderSeatTree([
    { id: "head-projects", parentProjectId: null },
    { id: "pm-bb", parentProjectId: "vp-boltrig" },
    { id: "vp-boltrig", parentProjectId: "head-projects" },
    { id: "head-delivery", parentProjectId: null },
  ]);
  assert.deepEqual(
    ordered.map((entry) => [entry.item.id, entry.depth]),
    [
      ["head-projects", 0],
      ["vp-boltrig", 1],
      ["pm-bb", 2],
      ["head-delivery", 0],
    ],
  );
});

test("a missing parent is a root", () => {
  const ordered = orderSeatTree([
    { id: "pm-orphan", parentProjectId: "missing" },
  ]);
  assert.equal(ordered[0]?.depth, 0);
});
