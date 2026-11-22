import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffSnapshots, listSourceFiles, pruneSnapshots, takeSnapshot, undoFix, unifiedDiff } from "../../dist/snapshots.js";
import { stripFrames } from "../../dist/capture.js";
import { fakeProject } from "./helpers.mjs";

const setup = () => {
  const root = fakeProject();
  const dir = join(root, ".reelnote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "src", "Title.tsx"), "export const a = 1;\nexport const b = 2;\n");
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(join(root, "node_modules", "x", "i.js"), "skip");
  writeFileSync(join(root, ".env"), "SECRET=1");
  return { root, dir };
};

test("only the project's own text files are copied", () => {
  const { root } = setup();
  assert.deepEqual(listSourceFiles(root), ["package.json", "src/Title.tsx", "src/index.ts"]);
});

test("a change is recorded, shown and undone exactly", () => {
  const { root, dir } = setup();
  const before = takeSnapshot(root, dir);
  writeFileSync(join(root, "src", "Title.tsx"), "export const a = 10;\nexport const b = 2;\n");
  writeFileSync(join(root, "src", "New.tsx"), "export const n = 1;\n");
  const after = takeSnapshot(root, dir);
  const d = diffSnapshots(dir, before, after);
  assert.deepEqual(d.files, [{ path: "src/New.tsx", added: 1, removed: 0 }, { path: "src/Title.tsx", added: 1, removed: 1 }]);
  assert.match(d.patch, /-export const a = 1;\n\+export const a = 10;/);
  const touched = undoFix(root, dir, before, after);
  assert.deepEqual(touched.sort(), ["src/New.tsx", "src/Title.tsx"]);
  assert.equal(readFileSync(join(root, "src", "Title.tsx"), "utf8"), "export const a = 1;\nexport const b = 2;\n");
  assert.ok(!existsSync(join(root, "src", "New.tsx")), "a file Claude created is removed");
});

test("undo refuses when a file changed again since", () => {
  const { root, dir } = setup();
  const before = takeSnapshot(root, dir);
  writeFileSync(join(root, "src", "Title.tsx"), "v2\n");
  const after = takeSnapshot(root, dir);
  writeFileSync(join(root, "src", "Title.tsx"), "v3 by you\n");
  assert.throws(() => undoFix(root, dir, before, after), /Changed again since the fix/);
  assert.equal(readFileSync(join(root, "src", "Title.tsx"), "utf8"), "v3 by you\n", "nothing was touched");
});

test("same content, same snapshot; unused ones are pruned", () => {
  const { root, dir } = setup();
  const a = takeSnapshot(root, dir);
  assert.equal(takeSnapshot(root, dir), a);
  writeFileSync(join(root, "src", "Title.tsx"), "changed\n");
  const b = takeSnapshot(root, dir);
  assert.ok(pruneSnapshots(dir, new Set([b])) > 0);
  assert.deepEqual(readdirSync(join(dir, "snapshots")).filter((f) => f.endsWith(".json")), [`${b}.json`]);
  assert.equal(diffSnapshots(dir, b, b).files.length, 0);
});

test("unified diff hunks", () => {
  const d = unifiedDiff("f", "1\n2\n3\n", "1\n2\n3\n4\n");
  assert.equal(d.added, 1);
  assert.match(d.text, /@@ -\d+,\d+ \+\d+,\d+ @@/);
});

test("filmstrip frames spread over the range", () => {
  assert.deepEqual(stripFrames(0, 110, 12), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
  assert.deepEqual(stripFrames(5, 7, 12), [5, 6, 7]);
  assert.deepEqual(stripFrames(9, 9), [9]);
});
