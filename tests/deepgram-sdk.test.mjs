import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEEPGRAM_INPUT_RATE, DEEPGRAM_OUTPUT_RATE, DEEPGRAM_MICROPHONE_OPTIONS,
  DEEPGRAM_RECONNECT_OPTIONS, appearsToBeLatePacket
} from "../lib/audio/sdk-profile.ts";

test("official SDK PCM configuration uses consistent, documented rates", () => {
  assert.equal(DEEPGRAM_INPUT_RATE, 16_000);
  assert.equal(DEEPGRAM_OUTPUT_RATE, 24_000);
  assert.equal(DEEPGRAM_MICROPHONE_OPTIONS.sampleRate, DEEPGRAM_INPUT_RATE);
  assert.equal(DEEPGRAM_MICROPHONE_OPTIONS.echoCancellation, true);
  assert.equal(DEEPGRAM_MICROPHONE_OPTIONS.noiseSuppression, true);
  assert.equal(DEEPGRAM_MICROPHONE_OPTIONS.autoGainControl, true);
});

test("reconnection delegates to the SDK and caps retry budget", () => {
  assert.equal(DEEPGRAM_RECONNECT_OPTIONS.enabled, true);
  assert.ok(DEEPGRAM_RECONNECT_OPTIONS.maxAttempts > 0);
  assert.ok(DEEPGRAM_RECONNECT_OPTIONS.maxAttempts <= 8);
  assert.ok(DEEPGRAM_RECONNECT_OPTIONS.maxDelay <= 30_000);
  assert.equal(DEEPGRAM_RECONNECT_OPTIONS.jitter, true);
});

test("estimated packet gaps exclude the beginning of an answer and ample buffered audio", () => {
  assert.equal(appearsToBeLatePacket(300, 0, false), false);
  assert.equal(appearsToBeLatePacket(300, 500, true), false);
  assert.equal(appearsToBeLatePacket(40, 0, true), false);
  assert.equal(appearsToBeLatePacket(180, 0, true), true);
});

test("NEON uses the official Session, Microphone and Player rather than custom audio machinery", () => {
  const source = readFileSync(new URL("../hooks/useVoiceAssistant.ts", import.meta.url), "utf8");
  assert.match(source, /new AgentSession\(/);
  assert.match(source, /new AgentMicrophone\(/);
  assert.match(source, /new AgentPlayer\(/);
  assert.match(source, /sdk\.on\("audio",/);
  assert.match(source, /sdk\.on\("settings-applied",/);
  assert.match(source, /sdk\.on\("user-started-speaking",/);
  assert.match(source, /sdk\.on\("agent-audio-done",/);
  assert.match(source, /player\.getRemainingPlaybackTime\(/);
  assert.doesNotMatch(source, /new WebSocket\(/);
  assert.doesNotMatch(source, /new AudioWorkletNode\(/);
  assert.doesNotMatch(source, /new AudioEngine\(/);
});

test("voice auth remains a backend-only short-lived bearer token", () => {
  const source = readFileSync(new URL("../hooks/useVoiceAssistant.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/deepgram\/token"/);
  assert.match(source, /tokenFactory: getScopedAgentToken/);
  assert.doesNotMatch(source, /process\.env\.DEEPGRAM_API_KEY/);
});
