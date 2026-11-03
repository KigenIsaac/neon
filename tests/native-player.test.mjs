import test from "node:test";
import assert from "node:assert/strict";
import { NativePcmPlayer } from "../lib/audio/native-player.ts";

class FakeAudioContext {
  constructor(sampleRate = 48000) {
    this.currentTime = 0;
    this.sampleRate = sampleRate;
    this.outputLatency = 0.04;
    this.destination = {};
    this.sources = [];
    this.buffers = [];
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBuffer(channels, length, rate) {
    assert.equal(channels, 1);
    const data = new Float32Array(length);
    const buffer = {
      sampleRate: rate, duration: length / rate,
      getChannelData(ch) { assert.equal(ch, 0); return data; }
    };
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    const node = {
      buffer: null, onended: null,
      startedAt: null, stopped: false,
      connect() {}, disconnect() {},
      start(at) { this.startedAt = at; },
      stop() { this.stopped = true; },
      finish() { this.onended?.(); }
    };
    this.sources.push(node);
    return node;
  }
}

function makePcm(samples, sample = 12000) {
  const values = new Int16Array(samples);
  values.fill(sample);
  return values.buffer;
}

test("browser-native audio preserves 24 kHz PCM16 regardless of output device rate", () => {
  for (const deviceRate of [24000, 44100, 48000, 96000]) {
    const ctx = new FakeAudioContext(deviceRate);
    const player = new NativePcmPlayer(ctx);
    player.queue(makePcm(2400));
    assert.equal(ctx.buffers[0].sampleRate, 24000);
    assert.equal(ctx.buffers[0].duration, 0.1);
    assert.equal(ctx.sources[0].startedAt, 0.025);
    assert.equal(ctx.buffers[0].getChannelData(0)[0], 12000 / 32768);
    assert.equal(player.getDiagnostics().outputSampleRate, deviceRate);
    assert.equal(player.getDiagnostics().outputLatencyMs, 40);
    player.dispose();
  }
});

test("multiple incoming audio packets are sample-accurately scheduled without new buffering", () => {
  const ctx = new FakeAudioContext();
  const player = new NativePcmPlayer(ctx);
  player.queue(makePcm(480)); // 20 ms
  player.queue(makePcm(480));
  player.queue(makePcm(480));
  assert.ok(Math.abs(ctx.sources[0].startedAt - 0.025) < 1e-9);
  assert.ok(Math.abs(ctx.sources[1].startedAt - 0.045) < 1e-9);
  assert.ok(Math.abs(ctx.sources[2].startedAt - 0.065) < 1e-9);
  assert.equal(player.getDiagnostics().packetGaps, 0);
});

test("late packets schedule immediately instead of waiting for 100-280 ms prebuffer", () => {
  const ctx = new FakeAudioContext();
  const player = new NativePcmPlayer(ctx);
  player.queue(makePcm(480));
  ctx.currentTime = 0.18; // A real network delay while the agent is speaking.
  player.queue(makePcm(480));
  assert.ok(ctx.sources[1].startedAt < 0.22, "late packet must not wait for a large prebuffer");
  assert.equal(player.getDiagnostics().packetGaps, 1);
});

test("AgentAudioDone waits for all scheduled sources to finish before notifying", () => {
  const ctx = new FakeAudioContext();
  const events = [];
  const player = new NativePcmPlayer(ctx, {
    onSpeaking: (v) => events.push("speak:" + v),
    onDrained: () => events.push("drained")
  });
  player.queue(makePcm(480));
  player.queue(makePcm(480));
  player.serverAudioDone();
  assert.deepEqual(events, ["speak:true"]);
  ctx.sources[0].finish();
  assert.deepEqual(events, ["speak:true"]);
  ctx.sources[1].finish();
  assert.deepEqual(events, ["speak:true", "speak:false", "drained"]);
  player.serverAudioDone();
  assert.equal(events.filter((e) => e === "drained").length, 1);
});

test("interruption stops all pending native playback sources", () => {
  const ctx = new FakeAudioContext();
  const events = [];
  const player = new NativePcmPlayer(ctx, { onSpeaking: (v) => events.push(v) });
  player.queue(makePcm(960));
  player.queue(makePcm(960));
  player.interrupt();
  assert.deepEqual(events, [true, false]);
  assert.ok(ctx.sources.every((source) => source.stopped));
  for (const source of ctx.sources) source.finish();
  assert.deepEqual(events, [true, false]);
  player.queue(makePcm(480));
  assert.deepEqual(events, [true, false, true]);
});

test("PCM16 encoding is interpreted as little-endian and ignores an odd trailing byte", () => {
  const ctx = new FakeAudioContext();
  const player = new NativePcmPlayer(ctx);
  const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x5a]);
  player.queue(bytes.buffer);
  const data = ctx.buffers[0].getChannelData(0);
  assert.equal(data.length, 2);
  assert.equal(data[0], -1);
  assert.ok(data[1] > 0.99);
});
