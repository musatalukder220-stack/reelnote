import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioAnalyzer, SIZE, VideoChecker } from "../../dist/analyze.js";

// a moving picture: a bright bar sliding right over a grey background
const frame = (i, opts = {}) => {
  const f = new Uint8Array(SIZE).fill(opts.fill ?? 100);
  if (opts.fill === undefined) for (let y = 20; y < 70; y++) for (let x = 0; x < 30; x++) f[y * 160 + ((x + i * 3) % 160)] = 230;
  return f;
};
const run = (frames, fps = 30, expected = null) => {
  const c = new VideoChecker(fps);
  frames.forEach((f) => c.push(f));
  return c.finish(expected);
};

test("clean motion has no problems", () => {
  const r = run(Array.from({ length: 60 }, (_, i) => frame(i)));
  assert.equal(r.frames, 60);
  assert.deepEqual(r.issues, []);
});

test("a black flash is found", () => {
  const r = run(Array.from({ length: 30 }, (_, i) => (i === 12 ? frame(0, { fill: 0 }) : frame(i))));
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, "black-flash");
  assert.equal(r.issues[0].frame, 12);
});

test("a repeated frame during motion is a stutter", () => {
  const r = run(Array.from({ length: 30 }, (_, i) => frame(i === 15 ? 14 : i)));
  assert.deepEqual(r.issues.map((i) => [i.kind, i.frame]), [["stutter", 15]]);
});

test("a scene cut is not a problem", () => {
  const r = run(Array.from({ length: 30 }, (_, i) => (i < 15 ? frame(i) : frame(i, { fill: 30 }))));
  assert.ok(!r.issues.some((i) => i.level !== "info"));
});

test("a long hold is noted, not flagged", () => {
  const r = run(Array.from({ length: 120 }, () => frame(0)), 30);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, "frozen");
  assert.equal(r.issues[0].level, "info");
});

test("missing frames are an error", () => {
  const r = run(Array.from({ length: 10 }, (_, i) => frame(i)), 30, 12);
  assert.equal(r.issues[0].kind, "missing-frames");
});

const tone = (seconds, amp = 0.3, rate = 8000) => Int16Array.from({ length: seconds * rate }, (_, i) => Math.round(Math.sin(i / 3) * amp * 32767));
const silence = (seconds, rate = 8000) => new Int16Array(seconds * rate);

test("audio: loudness per frame, silent gap in the middle", () => {
  const a = new AudioAnalyzer(25);
  a.pushSamples(silence(1));
  a.pushSamples(tone(1));
  a.pushSamples(silence(1));
  a.pushSamples(tone(1));
  a.pushSamples(silence(1));
  const r = a.finish();
  assert.equal(r.frames, 125);
  assert.equal(r.peaks.length, 125);
  const gaps = r.issues.filter((i) => i.kind === "silence");
  assert.equal(gaps.length, 1, "leading and trailing silence are not gaps");
  assert.ok(Math.abs(gaps[0].frame - 50) <= 1);
  assert.ok(r.peakDb < -9 && r.peakDb > -12);
});

test("audio: clipping is found", () => {
  const a = new AudioAnalyzer(30);
  a.pushSamples(tone(1, 1.2).map((v) => Math.max(-32768, Math.min(32767, v))));
  assert.ok(a.finish().issues.some((i) => i.kind === "clipping"));
});

test("audio: frame count stays exact with fractional samples per frame", () => {
  const a = new AudioAnalyzer(29.97);
  a.pushSamples(tone(10));
  assert.ok(Math.abs(a.finish().frames - 299.7) <= 1);
});
