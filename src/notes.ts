// Notes live next to the film: <project>/.reelnote/notes.json, pictures in <project>/.reelnote/notes/.
// The app and the MCP server are separate processes, so every change goes through a short lock and an atomic rename.
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Mark, Note } from "./types.js";
import { frameLabel } from "./util.js";

export const SUBDIRS = ["notes", "frames", "build", "audio", "reports"] as const;

export const dataDir = (root: string) => {
  const dir = join(root, ".reelnote");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    // keeps the folder out of git without touching the project's own .gitignore
    writeFileSync(join(dir, ".gitignore"), "*\n");
  }
  for (const sub of SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
};

const notesFile = (root: string) => join(dataDir(root), "notes.json");

// Older or hand-edited notes are brought up to the current shape.
const normalize = (n: Partial<Note> & Record<string, unknown>): Note => ({
  id: Number(n.id),
  composition: String(n.composition ?? ""),
  frame: Number(n.frame ?? 0),
  endFrame: n.endFrame === undefined || n.endFrame === null ? null : Number(n.endFrame),
  fps: Number(n.fps ?? 30),
  width: Number(n.width ?? 0),
  height: Number(n.height ?? 0),
  kind: n.kind === "audio" ? "audio" : "visual",
  text: String(n.text ?? ""),
  marks: Array.isArray(n.marks) ? (n.marks as Mark[]) : [],
  image: (n.image as string) ?? null,
  clean: (n.clean as string) ?? null,
  status: n.status === "fixed" ? "fixed" : "open",
  replies: Array.isArray(n.replies) ? n.replies : [],
  created: String(n.created ?? new Date().toISOString()),
  fixed: (n.fixed as string) ?? null,
});

export const loadNotes = (root: string): Note[] => {
  const p = notesFile(root);
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(data.notes) ? data.notes.map(normalize) : [];
  } catch {
    return [];
  }
};

const write = (root: string, notes: Note[]) => {
  const p = notesFile(root);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 2, notes }, null, 2));
  renameSync(tmp, p);
};

const lock = (root: string) => {
  const dir = join(dataDir(root), "notes.lock");
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(dir);
      return () => {
        try {
          rmdirSync(dir);
        } catch {
          /* already released */
        }
      };
    } catch {
      // a lock older than 10 s belongs to a process that died
      try {
        if (Date.now() - statSync(dir).mtimeMs > 10000) rmdirSync(dir);
      } catch {
        /* raced with its owner */
      }
      if (Date.now() > deadline) throw new Error("Notes are locked by another ReelNote process.");
      const until = Date.now() + 15;
      while (Date.now() < until) {
        /* short spin: notes writes take a millisecond */
      }
    }
  }
};

export const updateNotes = <T>(root: string, fn: (notes: Note[]) => { notes: Note[]; result: T }): T => {
  const release = lock(root);
  try {
    const { notes, result } = fn(loadNotes(root));
    write(root, notes);
    return result;
  } finally {
    release();
  }
};

export const nextId = (notes: Note[]) => notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;

const r = Math.round;
const bbox = (pts: [number, number][]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return `x ${r(Math.min(...xs))}–${r(Math.max(...xs))}, y ${r(Math.min(...ys))}–${r(Math.max(...ys))}`;
};

export const describeMark = (m: Mark): string => {
  switch (m.type) {
    case "ellipse":
      return `circled area x ${r(m.cx - m.rx)}–${r(m.cx + m.rx)}, y ${r(m.cy - m.ry)}–${r(m.cy + m.ry)}`;
    case "rect":
      return `box x ${r(m.x)}–${r(m.x + m.w)}, y ${r(m.y)}–${r(m.y + m.h)}`;
    case "arrow":
      return `arrow pointing at (${r(m.x2)}, ${r(m.y2)}) from (${r(m.x1)}, ${r(m.y1)})`;
    case "pen":
      return m.points.length ? `freehand mark around ${bbox(m.points)}` : "freehand mark";
  }
};

export const describeMarks = (marks: Mark[]) => (marks.length ? marks.map(describeMark).join("; ") + " (composition pixels)" : "no mark");

export const noteSummary = (n: Note) => {
  const lines = [
    `#${n.id} · ${n.composition} · ${frameLabel(n.frame, n.endFrame, n.fps)} · ${n.kind === "audio" ? "sound" : "picture"} · ${n.status}`,
    `   "${n.text}"`,
    `   ${n.kind === "audio" ? "about the sound in this stretch" : describeMarks(n.marks)}${n.width ? ` · composition ${n.width}×${n.height}` : ""}`,
  ];
  for (const rep of n.replies) lines.push(`   ${rep.by === "claude" ? "Claude" : "User"}: ${rep.text}`);
  return lines.join("\n");
};
