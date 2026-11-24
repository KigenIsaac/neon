import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "neon-localisation-"));
after(() => rmSync(temp, { recursive: true, force: true }));
for (const name of ["localisation", "prompt", "settings"]) {
  const input = readFileSync(new URL("../lib/agent/" + name + ".ts", import.meta.url), "utf8");
  const output = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(temp, name + ".js"), output.outputText);
}
const require = createRequire(import.meta.url);
const { LOCALE_IDS, LOCALE_PROFILES, DEFAULT_LOCALE, parseVoiceLocale } = require(join(temp, "localisation.js"));
const { buildSettings } = require(join(temp, "settings.js"));

test("Kenyan English is the safe default and invalid preferences fall back", () => {
  assert.equal(DEFAULT_LOCALE, "kenyan-english");
  for (const value of [null, undefined, "", "en-KE", "__proto__", {}]) assert.equal(parseVoiceLocale(value), DEFAULT_LOCALE);
  for (const id of LOCALE_IDS) assert.equal(parseVoiceLocale(id), id);
});

test("Kenyan profile biases local vocabulary and preserves voice/visual pipeline", () => {
  const config = buildSettings();
  assert.equal(config.agent.listen.provider.language, "en");
  assert.ok(config.agent.listen.provider.keyterms.includes("M-Pesa"));
  assert.ok(config.agent.listen.provider.keyterms.includes("Eldama Ravine"));
  assert.ok(config.agent.think.prompt.includes("Kenyan shillings"));
  assert.ok(config.agent.think.prompt.includes("Confirm ambiguous"));
  assert.equal(config.agent.speak.provider.model, "aura-2-zeus-en");
  assert.equal(config.agent.think.functions[0].name, "visual_scene");
  assert.equal(config.audio.input.sample_rate, 24000);
  assert.equal(config.audio.output.sample_rate, 24000);
  assert.equal(config.flags.history, true);
});

test("Kiswahili input explicitly selects sw and English output", () => {
  const config = buildSettings("kiswahili-input");
  assert.equal(config.agent.listen.provider.language, "sw");
  assert.match(config.agent.think.prompt, /answer naturally in Kenyan English/);
  assert.equal(config.agent.speak.provider.model, "aura-2-zeus-en");
});

test("international fallback omits Kenyan bias", () => {
  const config = buildSettings("international");
  assert.equal(config.agent.listen.provider.language, "en");
  assert.equal(config.agent.listen.provider.smart_format, false);
  assert.equal(config.agent.listen.provider.keyterms, undefined);
  assert.ok(!config.agent.think.prompt.includes("KENYAN LINGUISTIC"));
});

test("session settings do not mutate shared profiles", () => {
  const config = buildSettings();
  config.agent.listen.provider.keyterms.push("test mutation");
  assert.ok(!LOCALE_PROFILES[DEFAULT_LOCALE].keyterms.includes("test mutation"));
  for (const id of LOCALE_IDS) assert.ok(LOCALE_PROFILES[id].description.length > 0);
});
