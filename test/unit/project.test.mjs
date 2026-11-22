import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configString, findEntry, findProject, findPublicDir, inside, listPublicFiles } from "../../dist/project.js";
import { fakeProject } from "./helpers.mjs";

test("finds the project from a subfolder", () => {
  const root = fakeProject();
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  const p = findProject(join(root, "src", "deep"));
  assert.equal(p.root, root);
  assert.equal(p.name, "fake-film");
});

test("not a Remotion project", () => {
  const root = fakeProject({ dependencies: { react: "19" } });
  assert.equal(findProject(root)?.root === root, false);
});

test("entry point and public folder from remotion.config.ts", () => {
  const root = fakeProject();
  mkdirSync(join(root, "video"));
  writeFileSync(join(root, "video", "main.tsx"), "");
  writeFileSync(join(root, "remotion.config.ts"), `import {Config} from "@remotion/cli/config";\n// Config.setEntryPoint("nope.ts");\nConfig.setEntryPoint("./video/main.tsx");\nConfig.setPublicDir('assets');\n`);
  assert.equal(configString(root, "setEntryPoint"), "./video/main.tsx");
  assert.equal(findEntry(root), join(root, "video", "main.tsx"));
  assert.equal(findPublicDir(root), join(root, "assets"));
  assert.equal(findEntry(root, "src/index.ts"), join(root, "src", "index.ts"), "--entry wins");
});

test("paths can't escape their folder", () => {
  const root = fakeProject();
  assert.equal(inside(root, "package.json"), join(root, "package.json"));
  assert.equal(inside(root, "/package.json"), join(root, "package.json"));
  assert.equal(inside(root, "../../etc/passwd"), null);
  assert.equal(inside(root, "%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(inside(root, "src"), null, "folders aren't files");
});

test("public files are listed like getStaticFiles()", () => {
  const root = fakeProject();
  mkdirSync(join(root, "public", "img"), { recursive: true });
  writeFileSync(join(root, "public", "img", "a b.png"), "x");
  writeFileSync(join(root, "public", ".hidden"), "x");
  const files = listPublicFiles(join(root, "public"), "/base");
  assert.deepEqual(files.map((f) => [f.name, f.src]), [["img/a b.png", "/base/img/a%20b.png"]]);
});
