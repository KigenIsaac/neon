import test from "node:test";
import assert from "node:assert/strict";
import { parseScene } from "../lib/visuals/validation.ts";
import { inferScene } from "../lib/visuals/heuristics.ts";

test("accepts and sanitizes valid AI scenes", () => {
  const scene = parseScene({
    id: "sample",
    layout: "compare",
    boxes: [
      { id: "one", kind: "text", title: "Safe", body: "Hello", accent: "#5fd0ff" },
      { kind: "metric", value: 12.5, unit: "ms", accent: "url(evil)" }
    ]
  });
  assert.ok(scene);
  assert.equal(scene?.layout, "compare");
  assert.equal(scene?.boxes[0].body, "Hello");
  assert.equal(scene?.boxes[1].accent, undefined);
});

test("rejects excessive or structurally invalid scenes", () => {
  assert.equal(parseScene(null), null);
  assert.equal(parseScene({ layout: "x", boxes: [] }), null);
  assert.equal(parseScene({ layout: "hero", boxes: [] }), null);
  assert.equal(parseScene({ layout: "hero", boxes: Array.from({ length: 9 }, () => ({ kind: "text" })) }), null);
  assert.equal(parseScene({ layout: "hero", boxes: [{ kind: "script" }] }), null);
  assert.equal(parseScene({ layout: "hero", boxes: [{ kind: "chart", values: [Infinity] }] }), null);
  assert.equal(parseScene({ layout: "hero", boxes: [{ kind: "list", items: [42] }] }), null);
});

test("bounded contents cannot create oversized UI text", () => {
  const scene = parseScene({ layout: "hero", boxes: [{ kind: "text", body: "x".repeat(3000) }] });
  assert.equal(scene?.boxes[0].body?.length, 600);
});

test("heuristic output remains accepted by the validation layer", () => {
  const inferred = inferScene("Sales reached 23% compared to Cost at 12%.");
  if (inferred) assert.ok(parseScene(inferred));
});
