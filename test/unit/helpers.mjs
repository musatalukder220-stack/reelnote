import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// a throwaway folder that looks like a Remotion project
export const fakeProject = (extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), "reelnote-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake-film", dependencies: { remotion: "4.0.0" }, ...extra }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "// entry\n");
  return root;
};
