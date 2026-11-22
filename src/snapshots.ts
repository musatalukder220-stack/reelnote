// What did Claude change? ReelNote keeps its own copies of the project's text files (no git needed):
// a snapshot is a list of path → content hash, contents stored once in .reelnote/snapshots/blobs.
// A fix is the difference between the snapshot when Claude started on a note and the one when it marked it fixed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const TEXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".sass", ".less", ".md", ".mdx", ".txt",
  ".html", ".svg", ".yml", ".yaml", ".toml", ".srt", ".vtt", ".csv", ".glsl", ".frag", ".vert"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".reelnote", "out", "dist", "build", ".next", ".turbo", ".cache", "coverage"]);
const MAX_FILE = 512 * 1024;
const MAX_FILES = 4000;

export type Manifest = Record<string, string>; // path (with /) → sha1

const dirs = (dataDir: string) => {
  const base = join(dataDir, "snapshots");
  const blobs = join(base, "blobs");
  mkdirSync(blobs, { recursive: true });
  return { base, blobs };
};

export const listSourceFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.startsWith(".env")) continue; // secrets stay out of copies
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e) && !e.startsWith(".")) walk(p);
      } else if (TEXT.has(extname(e).toLowerCase()) && st.size <= MAX_FILE && e !== "package-lock.json" && e !== "pnpm-lock.yaml" && e !== "yarn.lock") {
        out.push(relative(root, p).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
};

export const takeSnapshot = (root: string, dataDir: string): string => {
  const { base, blobs } = dirs(dataDir);
  const manifest: Manifest = {};
  for (const rel of listSourceFiles(root)) {
    const buf = readFileSync(join(root, rel));
    const h = createHash("sha1").update(buf).digest("hex");
    const blob = join(blobs, h);
    if (!existsSync(blob)) writeFileSync(blob, buf);
    manifest[rel] = h;
  }
  const id = createHash("sha1").update(JSON.stringify(manifest)).digest("hex").slice(0, 16);
  const file = join(base, `${id}.json`);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(manifest));
  return id;
};

export const readSnapshot = (dataDir: string, id: string): Manifest | null => {
  const f = join(dirs(dataDir).base, `${id}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Manifest) : null;
};

const blobText = (dataDir: string, h: string | undefined) => (h ? readFileSync(join(dirs(dataDir).blobs, h), "utf8") : "");

// ---------- line diff (Myers) ----------
type Op = { t: " " | "-" | "+"; line: string };
export const diffLines = (a: string[], b: string[]): Op[] => {
  const n = a.length, m = b.length, max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) [x, y] = [x + 1, y + 1];
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  // walk back
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vv.get(prevK) ?? 0, prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ t: " ", line: a[--x] }) && y--;
    if (d > 0) {
      if (x === prevX) ops.push({ t: "+", line: b[--y] });
      else ops.push({ t: "-", line: a[--x] });
    }
  }
  return ops.reverse();
};

export const unifiedDiff = (path: string, before: string, after: string, context = 3) => {
  const lines = (t: string) => (t === "" ? [] : t.replace(/\r?\n$/, "").split(/\r?\n/));
  const a = lines(before), b = lines(after);
  const ops = diffLines(a, b);
  let added = 0, removed = 0;
  for (const o of ops) o.t === "+" ? added++ : o.t === "-" ? removed++ : 0;
  const out = [`--- a/${path}`, `+++ b/${path}`];
  // group changes with context into hunks
  let i = 0;
  let ai = 0, bi = 0;
  const pos: { a: number; b: number }[] = ops.map((o) => {
    const p = { a: ai, b: bi };
    if (o.t !== "+") ai++;
    if (o.t !== "-") bi++;
    return p;
  });
  while (i < ops.length) {
    if (ops[i].t === " ") {
      i++;
      continue;
    }
    let start = Math.max(0, i - context), end = i;
    while (end < ops.length) {
      if (ops[end].t !== " ") {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run].t === " ") run++;
      if (end + run >= ops.length || run > context * 2) {
        end = Math.min(ops.length, end + context);
        break;
      }
      end += run;
    }
    const slice = ops.slice(start, end);
    const aCount = slice.filter((o) => o.t !== "+").length, bCount = slice.filter((o) => o.t !== "-").length;
    out.push(`@@ -${pos[start].a + 1},${aCount} +${pos[start].b + 1},${bCount} @@`);
    for (const o of slice) out.push(`${o.t}${o.line}`);
    i = end;
  }
  return { text: out.join("\n"), added, removed };
};

export const diffSnapshots = (dataDir: string, fromId: string, toId: string) => {
  const from = readSnapshot(dataDir, fromId) ?? {}, to = readSnapshot(dataDir, toId) ?? {};
  const paths = Array.from(new Set([...Object.keys(from), ...Object.keys(to)])).sort();
  const files: { path: string; added: number; removed: number }[] = [];
  const patches: string[] = [];
  for (const p of paths) {
    if (from[p] === to[p]) continue;
    const d = unifiedDiff(p, blobText(dataDir, from[p]), blobText(dataDir, to[p]));
    files.push({ path: p, added: d.added, removed: d.removed });
    patches.push(d.text);
  }
  return { files, patch: patches.join("\n") };
};

// Put the files a fix touched back the way they were. Refused if any of them changed again since,
// so nothing newer is lost.
export const undoFix = (root: string, dataDir: string, fromId: string, toId: string) => {
  const from = readSnapshot(dataDir, fromId), to = readSnapshot(dataDir, toId);
  if (!from || !to) throw new Error("The copies for this fix are gone (cleaned up?).");
  const touched = Array.from(new Set([...Object.keys(from), ...Object.keys(to)])).filter((p) => from[p] !== to[p]);
  const now = takeSnapshot(root, dataDir);
  const current = readSnapshot(dataDir, now)!;
  const conflicts = touched.filter((p) => current[p] !== to[p]);
  if (conflicts.length) throw new Error(`Changed again since the fix, so not undone: ${conflicts.join(", ")}`);
  for (const p of touched) {
    const abs = join(root, ...p.split("/"));
    if (from[p]) {
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, readFileSync(join(dirs(dataDir).blobs, from[p])));
    } else rmSync(abs, { force: true });
  }
  return touched;
};

// remove snapshots (and their contents) that no note points to
export const pruneSnapshots = (dataDir: string, keep: Set<string>) => {
  const { base, blobs } = dirs(dataDir);
  const live = new Set<string>();
  let freed = 0;
  for (const f of readdirSync(base)) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -5);
    if (keep.has(id)) {
      for (const h of Object.values(JSON.parse(readFileSync(join(base, f), "utf8")) as Manifest)) live.add(h);
    } else {
      freed += statSync(join(base, f)).size;
      rmSync(join(base, f));
    }
  }
  for (const h of readdirSync(blobs)) {
    if (!live.has(h)) {
      freed += statSync(join(blobs, h)).size;
      rmSync(join(blobs, h));
    }
  }
  return freed;
};
