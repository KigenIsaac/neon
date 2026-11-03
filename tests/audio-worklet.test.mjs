import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { AUDIO_WORKLET_CODE } from "../lib/audio/worklet-code.ts";

function setup(rate = 48000) {
  const classes = {};
  const state = { sampleRate: rate, currentFrame: 0 };
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
    ...state, AudioWorkletProcessor,
    registerProcessor: (name, clazz) => { classes[name] = clazz; }
  });
  return classes;
}

test("microphone emits bounded PCM frames at 48k input", () => {
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

test("microphone streams correctly with a fractional 44.1k to 24k ratio", () => {
  const classes = setup(44100);
  const processor = new classes["microphone-processor"]();
  for (let i = 0; i < 150; i++) {
    processor.process([[new Float32Array(128).fill(0.1)]]);
  }
  const frames = processor.port.messages.filter((x) => x.type === "mic-pcm");
  const produced = frames.length * 480 + processor.frameCount;
  const expected = 150 * 128 * 24000 / 44100;
  assert.ok(Math.abs(produced - expected) <= 3, `${produced} not close to ${expected}`);
});

test("playback drains and stale audio is ignored after interruption", () => {
  const classes = setup();
  const processor = new classes["agent-playback-processor"]();
  const pcm = new Int16Array(4000).fill(7500).buffer;
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcm } });
  processor.port.onmessage({ data: { type: "server-done", generation: 0 } });
  for (let i = 0; i < 75; i++) processor.process([], [[new Float32Array(128)]]);
  assert.ok(processor.port.messages.some((x) => x.type === "drained"));

  processor.port.onmessage({ data: { type: "flush", generation: 1 } });
  processor.port.onmessage({ data: { type: "audio", generation: 0, buffer: pcm } });
  assert.equal(processor.availableSamples(), 0);
});
