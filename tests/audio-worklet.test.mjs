import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { AUDIO_WORKLET_CODE } from "../lib/audio/worklet-code.ts";

function setup(rate = 48000) {
  const classes = {};
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        postMessage: (value) => this.port.messages.push(value),
        onmessage: null
      };
    }
  }
  vm.runInNewContext(AUDIO_WORKLET_CODE, {
    sampleRate: rate, currentFrame: 0, AudioWorkletProcessor,
    registerProcessor: (name, clazz) => { classes[name] = clazz; }
  });
  return classes;
}

function pcmSine(frequency, length = 12000, amplitude = 0.42) {
  const pcm = new Int16Array(length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.sin(i * 2 * Math.PI * frequency / 24000) * amplitude;
    pcm[i] = Math.round(sample * 32767);
  }
  return pcm.buffer;
}

function processAudio(processor, frames, quantum = 128) {
  const output = new Float32Array(frames);
  for (let at = 0; at < frames; at += quantum) {
    const block = new Float32Array(Math.min(quantum, frames - at));
    assert.equal(processor.process([], [[block]]), true);
    output.set(block, at);
  }
  return output;
}

test("microphone emits bounded 20 ms PCM frames at 48k input", () => {
  const classes = setup();
  const processor = new classes["microphone-processor"]();
  for (let i = 0; i < 90; i++) {
    assert.equal(processor.process([[new Float32Array(128).fill(0.25)]]), true);
  }
  const frames = processor.port.messages.filter((message) => message.type === "mic-pcm");
  assert.ok(frames.length >= 11);
  for (const frame of frames) {
    const data = new Int16Array(frame.buffer);
    assert.equal(data.length, 480);
    assert.ok(data.every((v) => v >= 8180 && v <= 8200));
  }
});

test("microphone keeps fractional 44.1 kHz and 96 kHz input phase", () => {
  for (const rate of [44100, 96000]) {
    const classes = setup(rate);
    const processor = new classes["microphone-processor"]();
    for (let i = 0; i < 150; i++) processor.process([[new Float32Array(128).fill(0.1)]]);
    const frames = processor.port.messages.filter((x) => x.type === "mic-pcm");
    const produced = frames.length * 480 + processor.frameCount;
    const expected = 150 * 128 * 24000 / rate;
    assert.ok(Math.abs(produced - expected) <= 3, rate + ": resampler drifted " + produced + " vs " + expected);
  }
});

test("microphone clamps invalid and over-range inputs instead of wrapping PCM", () => {
  const classes = setup();
  const processor = new classes["microphone-processor"]();
  for (let i = 0; i < 20; i++) {
    const input = new Float32Array(128).fill(i % 2 ? -5 : 5);
    input[7] = Number.NaN;
    processor.process([[input]]);
  }
  const frames = processor.port.messages.filter((x) => x.type === "mic-pcm");
  assert.ok(frames.length > 0);
  for (const frame of frames) {
    for (const sample of new Int16Array(frame.buffer)) {
      assert.ok(Number.isFinite(sample) && sample >= -32768 && sample <= 32767);
    }
  }
});

test("playback resamples 24 kHz speech to desktop and mobile rates with fidelity", () => {
  for (const rate of [24000, 44100, 48000, 96000]) {
    const classes = setup(rate);
    const processor = new classes["agent-playback-processor"]();
    processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcmSine(440) } });
    processor.port.onmessage({ data: { type: "server-done", generation: 0 } });
    const output = processAudio(processor, Math.floor(rate * 0.5) + 500);
    const begin = Math.floor(rate * 0.06);
    const end = Math.floor(rate * 0.43);
    let error = 0;
    for (let n = begin; n < end; n++) {
      const expected = 0.42 * 0.98 * Math.sin(2 * Math.PI * 440 * n / rate);
      error += Math.abs(output[n] - expected);
    }
    error /= end - begin;
    assert.ok(error < 0.004, rate + " Hz waveform error " + error);
    assert.ok(processor.port.messages.some((x) => x.type === "drained"), rate + " Hz failed to drain");
  }
});

test("playback supports variable browser rendering quantum sizes", () => {
  for (const quantum of [64, 128, 256, 512]) {
    const classes = setup(44100);
    const processor = new classes["agent-playback-processor"]();
    processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcmSine(330, 8000) } });
    processor.port.onmessage({ data: { type: "server-done", generation: 0 } });
    const output = processAudio(processor, 14500, quantum);
    const active = output.filter((v) => Math.abs(v) > 0.1).length;
    assert.ok(active > 3000, "quantum " + quantum + ": too little sound");
    assert.ok(output.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  }
});

test("playback uses one fixed ring buffer even during sustained streaming", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const originalRing = processor.ring;
  const chunk = pcmSine(220, 960);
  for (let i = 0; i < 120; i++) {
    processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: chunk } });
    processAudio(processor, 1152);
  }
  assert.equal(processor.ring, originalRing);
  assert.equal(processor.ring.length, 1 << 18);
  assert.ok(processor.availableSamples() >= 0);
});

test("network underruns adapt the jitter buffer and playback recovers", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const initial = processor.prebufferSamples;
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcmSine(450, 4000) } });
  processAudio(processor, 16000);
  assert.equal(processor.state, "buffering");
  assert.ok(processor.prebufferSamples > initial);
  assert.ok(processor.port.messages.some((x) => x.type === "underrun"));
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcmSine(450, 9000) } });
  const recovered = processAudio(processor, 1500);
  assert.ok(recovered.some((v) => Math.abs(v) > 0.01));
  assert.equal(processor.state, "playing");
});

test("playback bounds queued audio during long producer bursts", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const chunk = pcmSine(220, 24000);
  for (let i = 0; i < 15; i++) {
    processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: chunk } });
  }
  assert.ok(processor.writeIndex - processor.readIndex <= processor.maxQueuedSamples);
  assert.ok(processor.port.messages.some((x) => x.type === "overflow"));
  assert.ok(processAudio(processor, 200).every(Number.isFinite));
});

test("playback drains and ignores stale packets after interruption", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const pcm = new Int16Array(4000).fill(7500).buffer;
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcm } });
  processor.port.onmessage({ data: { type: "server-done", generation: 0 } });
  processAudio(processor, 15000);
  assert.ok(processor.port.messages.some((x) => x.type === "drained"));
  processor.port.onmessage({ data: { type: "flush", generation: 1 } });
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcm } });
  assert.equal(processor.availableSamples(), 0);
  assert.equal(processor.state, "idle");
});

test("short voice responses play without waiting for the full prebuffer", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const pcm = new Int16Array(250).fill(9000).buffer;
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcm } });
  processor.port.onmessage({ data: { type: "server-done", generation: 0 } });
  const output = processAudio(processor, 1200);
  assert.ok(output.some((sample) => sample > 0.1));
  assert.ok(processor.port.messages.some((x) => x.type === "drained"));
});
