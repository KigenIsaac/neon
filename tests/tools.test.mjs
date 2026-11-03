import test from "node:test";
import assert from "node:assert/strict";
import { calculateExpression, runAgentTool } from "../lib/agent/tools.ts";

test("calculator respects arithmetic precedence and parentheses", () => {
  assert.equal(calculateExpression("2 + 3 * 4"), 14);
  assert.equal(calculateExpression("(2 + 3) * 4"), 20);
  assert.equal(calculateExpression("-7 + 2"), -5);
  assert.equal(calculateExpression("10 % 3"), 1);
  assert.equal(calculateExpression("3.5 * 2"), 7);
  assert.equal(calculateExpression("1e3 + 5"), 1005);
});

test("calculator rejects unsafe input, malformed math and infinity", () => {
  for (const expression of [
    "alert(1)", "2 +", "2 / 0", "1e999", "(2+3",
    "1; process.exit()", "0/0", "2 ** 3", "1+1 )", "", "9".repeat(130)
  ]) {
    assert.throws(() => calculateExpression(expression), undefined, expression);
  }
});

test("read-only time tool returns parsable ISO time and a time zone", async () => {
  const raw = await runAgentTool("get_current_time", {}, { confirmSave: () => false });
  const result = JSON.parse(raw);
  assert.ok(Number.isFinite(Date.parse(result.utc_date_time)));
  assert.equal(typeof result.user_time_zone, "string");
  assert.equal(typeof result.local_date_time, "string");
});

test("side-effecting save tool explicitly asks and respects declines", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw Error("should never call"); };
  try {
    const raw = await runAgentTool("save_note", { content: "My test note" }, {
      confirmSave: () => false
    });
    assert.equal(JSON.parse(raw).saved, false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown tools and invalid notes fail closed", async () => {
  await assert.rejects(() => runAgentTool("run_shell", {}, { confirmSave: () => true }), /Unsupported tool/);
  await assert.rejects(() => runAgentTool("save_note", { content: "x".repeat(601) }, { confirmSave: () => true }), /600/);
});

test("tool calculator returns a JSON result", async () => {
  const raw = await runAgentTool("calculate", { expression: "12/4" }, {
    confirmSave: () => false
  });
  assert.deepEqual(JSON.parse(raw), { result: 3 });
});
