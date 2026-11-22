import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, describeMark, describeMarks, loadNotes, nextId, noteSummary, updateNotes } from "../../dist/notes.js";
import { fakeProject } from "./helpers.mjs";

const note = (id, extra = {}) => ({ id, composition: "Intro", frame: 10, endFrame: null, fps: 30, width: 1920, height: 1080, kind: "visual", text: "too dark",
  marks: [], image: null, clean: null, status: "open", replies: [], created: new Date().toISOString(), fixed: null, ...extra });

test("data folder ignores itself in git", () => {
  const root = fakeProject();
  const dir = dataDir(root);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n");
  for (const sub of ["notes", "frames", "build", "audio", "reports"]) assert.ok(existsSync(join(dir, sub)));
});

test("notes round-trip and ids grow", () => {
  const root = fakeProject();
  assert.deepEqual(loadNotes(root), []);
  updateNotes(root, (n) => ({ notes: [...n, note(1)], result: null }));
  updateNotes(root, (n) => ({ notes: [...n, note(nextId(n))], result: null }));
  const all = loadNotes(root);
  assert.deepEqual(all.map((n) => n.id), [1, 2]);
  assert.equal(nextId(all), 3);
  assert.ok(!existsSync(join(root, ".reelnote", "notes.lock")), "lock released");
});

test("old notes (v1 shape) are upgraded", () => {
  const root = fakeProject();
  writeFileSync(join(dataDir(root), "notes.json"), JSON.stringify({ version: 1, notes: [{ id: 4, composition: "A", frame: 3, fps: 25, text: "x", shape: { type: "ellipse" }, status: "fixed", reply: "done" }] }));
  const [n] = loadNotes(root);
  assert.equal(n.kind, "visual");
  assert.deepEqual(n.marks, []);
  assert.deepEqual(n.replies, []);
  assert.equal(n.endFrame, null);
  assert.equal(n.status, "fixed");
});

test("a broken notes file reads as empty instead of crashing", () => {
  const root = fakeProject();
  writeFileSync(join(dataDir(root), "notes.json"), "{ not json");
  assert.deepEqual(loadNotes(root), []);
});

test("marks are described in composition pixels", () => {
  assert.equal(describeMark({ type: "ellipse", cx: 100, cy: 50, rx: 20, ry: 10 }), "circled area x 80–120, y 40–60");
  assert.equal(describeMark({ type: "rect", x: 1, y: 2, w: 3, h: 4 }), "box x 1–4, y 2–6");
  assert.match(describeMark({ type: "arrow", x1: 0, y1: 0, x2: 10, y2: 20 }), /pointing at \(10, 20\)/);
  assert.equal(describeMark({ type: "pen", points: [[5, 5], [15, 25]] }), "freehand mark around x 5–15, y 5–25");
  assert.equal(describeMarks([]), "no mark");
});

test("summary mentions range, sound and conversation", () => {
  const s = noteSummary(note(7, { kind: "audio", endFrame: 40, replies: [{ by: "claude", text: "Which sound?", at: "" }] }));
  assert.match(s, /frames 10–40/);
  assert.match(s, /sound/);
  assert.match(s, /Claude: Which sound\?/);
});
