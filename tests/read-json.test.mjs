import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson } from "../lib/server/read-json.ts";

function request(body) {
  return new Request("https://neon.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

test("bounded parser accepts ordinary JSON objects", async () => {
  const result = await readBoundedJson(request('{"hello":"world"}'), 100);
  assert.equal(result.error, null);
  assert.deepEqual(result.value, { hello: "world" });
});

test("bounded parser rejects body before parsing if it is too large", async () => {
  const result = await readBoundedJson(request(JSON.stringify({ text: "x".repeat(5000) })), 100);
  assert.equal(result.error?.status, 413);
});

test("bounded parser rejects arrays and invalid JSON", async () => {
  const a = await readBoundedJson(request("[1,2,3]"), 100);
  assert.equal(a.error?.status, 400);
  const b = await readBoundedJson(request("{bad"), 100);
  assert.equal(b.error?.status, 400);
});
