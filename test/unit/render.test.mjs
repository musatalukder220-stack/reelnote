import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, outputPath, parseProgress, renderArgs } from "../../dist/render.js";

test("settings are cleaned", () => {
  assert.deepEqual(cleanSettings(undefined), { codec: "h264", scale: 1, crf: null, concurrency: "auto", range: null, muted: false });
  const s = cleanSettings({ codec: "nope", scale: 99, crf: 200, concurrency: 0, range: [90, 10], muted: 1 });
  assert.equal(s.codec, "h264");
  assert.equal(s.scale, 4);
  assert.equal(s.crf, 63);
  assert.equal(s.concurrency, 1);
  assert.deepEqual(s.range, [10, 90]);
  assert.equal(s.muted, true);
  assert.equal(cleanSettings({ codec: "prores", crf: 20 }).crf, null, "prores has no crf");
});

test("render command", () => {
  const item = { id: "1", kind: "video", composition: "Intro", settings: cleanSettings({ codec: "vp9", scale: 0.5, crf: 30, range: [0, 99], muted: true }), durationInFrames: 300, fps: 30, added: 0 };
  const out = outputPath("/p", "/p/.reelnote", item);
  assert.equal(out, "/p/out/Intro-0-99.webm");
  assert.deepEqual(renderArgs("src/index.ts", item, out, 2), ["remotion", "render", "src/index.ts", "Intro", out, "--concurrency=2", "--log=info", "--codec=vp9", "--scale=0.5", "--crf=30", "--muted", "--frames=0-99"]);
});

test("sound-only job", () => {
  const item = { id: "2", kind: "waveform", composition: "My Comp", settings: cleanSettings({}), durationInFrames: 10, fps: 30, added: 0 };
  const out = outputPath("/p", "/p/.reelnote", item);
  assert.equal(out, "/p/.reelnote/audio/My_Comp.wav");
  assert.ok(renderArgs("e.ts", item, out, 1).includes("--codec=wav"));
});

test("progress lines", () => {
  assert.deepEqual(parseProgress("Rendered 120/900, time remaining: 1m 20s"), { kind: "rendered", done: 120, total: 900, eta: "1m 20s" });
  assert.deepEqual(parseProgress("Rendered 900/900"), { kind: "rendered", done: 900, total: 900, eta: null });
  assert.equal(parseProgress("Encoded 300/900").kind, "encoded");
  assert.equal(parseProgress("hello"), null);
});
