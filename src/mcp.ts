// ReelNote MCP server (stdio): lets Claude Code read your notes, see the marked frames, look at any frame of the
// live preview, compare before and after, reply, mark notes fixed, check the sound and start a safe render.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { dataDir, loadNotes, noteSummary, updateNotes } from "./notes.js";
import { diffSnapshots, takeSnapshot } from "./snapshots.js";
import { findProject } from "./project.js";
import type { AudioCheck, CompositionInfo, Issue, Job, ServerInfo } from "./types.js";
import { safeName, timecode, VERSION } from "./util.js";

const INSTRUCTIONS = `ReelNote holds review notes for this Remotion video. A note is a frame (or a stretch of frames), the user's words and a picture of the frame with what they marked (circles, boxes, arrows, freehand). Sound notes are about the audio in that stretch.
Work through notes one at a time: reelnote_notes to list the open ones, reelnote_note to see one (this also starts tracking what you change for it), fix the code, then reelnote_compare (the picture before vs the live frame now; the preview reloads by itself when code changes) or reelnote_frame for any other frame. For motion or timing notes over a range of frames, reelnote_strip shows many frames side by side. When it's right, reelnote_note_update with status "fixed" and a one-line reply saying what you changed; ReelNote records the files you changed so the user can review or undo them. If a note is unclear, ask with reelnote_reply instead of guessing. Notes may come from reviewers (named in the note).
Never render the whole video to check a fix: reelnote_frame, reelnote_strip and reelnote_compare show it without rendering. For sound, reelnote_audio gives loudness in LUFS (YouTube aims for -14), silent gaps and clipping. When every note is fixed, reelnote_render makes the final video once and checks every frame and the sound; after a second render, reelnote_render_diff shows which frames changed.`;

const TOOLS = [
  {
    name: "reelnote_notes",
    description: "List the review notes the user left (frame or frame range, time, text, what they marked and where, status, conversation).",
    inputSchema: { type: "object", properties: {
      status: { type: "string", enum: ["open", "fixed", "all"], description: "Which notes. Default: open." },
      composition: { type: "string", description: "Only notes on this composition." },
    } },
  },
  {
    name: "reelnote_note",
    description: "One note: its text, the conversation, and the picture of the frame with what the user marked.",
    inputSchema: { type: "object", properties: { id: { type: "number", description: "Note number, e.g. 3" } }, required: ["id"] },
  },
  {
    name: "reelnote_frame",
    description: "Picture of any frame of a composition, straight from the live preview (no render). Use it to check a fix. Needs the ReelNote window to be open.",
    inputSchema: { type: "object", properties: {
      composition: { type: "string", description: "Composition id" }, frame: { type: "number", description: "Frame number (0-based)" },
    }, required: ["composition", "frame"] },
  },
  {
    name: "reelnote_strip",
    description: "A filmstrip: several frames of a range side by side in one picture, from the live preview. Use it to judge motion, timing and transitions. Needs the ReelNote window.",
    inputSchema: { type: "object", properties: {
      composition: { type: "string" }, from: { type: "number", description: "First frame" }, to: { type: "number", description: "Last frame" },
      count: { type: "number", description: "How many frames (2–16, default 12)" },
    }, required: ["composition", "from", "to"] },
  },
  {
    name: "reelnote_changes",
    description: "The code changes recorded for a fixed note (a diff), and whether the user undid them.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
  {
    name: "reelnote_render_diff",
    description: "Compare the latest render of a composition with the one before it, frame by frame: which stretches changed. Use it to make sure a fix didn't change anything else.",
    inputSchema: { type: "object", properties: { composition: { type: "string" } }, required: ["composition"] },
  },
  {
    name: "reelnote_compare",
    description: "Before and after for a note: the frame as the user saw it when they wrote the note, and the same frame live now. Needs the ReelNote window.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
  {
    name: "reelnote_note_update",
    description: "Mark a note fixed (or open again), with a one-line reply the user sees on the note.",
    inputSchema: { type: "object", properties: {
      id: { type: "number" }, status: { type: "string", enum: ["fixed", "open"] }, reply: { type: "string", description: "What you changed, in one line" },
    }, required: ["id", "status"] },
  },
  {
    name: "reelnote_reply",
    description: "Reply on a note without changing its status, e.g. to ask what the user means.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, text: { type: "string" } }, required: ["id", "text"] },
  },
  {
    name: "reelnote_compositions",
    description: "The compositions in this project: id, size, fps, length. Needs the ReelNote window to have been opened once.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reelnote_audio",
    description: "The sound of a composition: overall loudness, peak, silent gaps between sounds, clipping. The first call renders the sound only (quick); call again when it's done.",
    inputSchema: { type: "object", properties: { composition: { type: "string" }, refresh: { type: "boolean", description: "Render the sound again (after changing audio code)" } }, required: ["composition"] },
  },
  {
    name: "reelnote_render",
    description: "Render the final video once with safe settings (threads chosen from free memory unless set), then check every frame and the sound. Needs the ReelNote window.",
    inputSchema: { type: "object", properties: {
      composition: { type: "string" },
      codec: { type: "string", enum: ["h264", "h265", "vp9", "prores", "gif"], description: "Default h264 (mp4)" },
      scale: { type: "number", description: "1 = full size, 0.5 = half" },
      crf: { type: "number", description: "Quality: lower is better and bigger. Leave out for Remotion's default." },
      concurrency: { type: "number", description: "Frames at once. Leave out to choose from free memory." },
      from: { type: "number", description: "First frame (only part of the video)" },
      to: { type: "number", description: "Last frame" },
      muted: { type: "boolean" },
    }, required: ["composition"] },
  },
  {
    name: "reelnote_render_status",
    description: "Progress of the current render, free memory, and the result of the frame and sound check.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reelnote_report",
    description: "Export the notes as a report file (md, html or pdf) in .reelnote/reports/.",
    inputSchema: { type: "object", properties: {
      format: { type: "string", enum: ["md", "html", "pdf"] }, lang: { type: "string", enum: ["en", "bn"] }, status: { type: "string", enum: ["open", "fixed", "all"] },
    } },
  },
];

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
const text = (t: string): Content => ({ type: "text", text: t });
const image = (file: string): Content => ({ type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" });
const err = (t: string): Result => ({ content: [text(t)], isError: true });

const issueLines = (issues: Issue[]) => issues.map((i) => `  ${i.level === "error" ? "✗" : i.level === "warning" ? "!" : "·"} ${i.message}`).join("\n");

export const fmtJob = (j: Job | null) => {
  if (!j) return "No render has run in this ReelNote session.";
  const mem = j.memory ? ` · memory free ${j.memory.availableMB.toLocaleString("en-US")} MB${j.memory.swapUsedGB !== null ? `, swap ${j.memory.swapUsedGB.toFixed(1)} GB` : ""}` : "";
  const what = j.kind === "waveform" ? `sound of ${j.composition}` : j.composition;
  switch (j.status) {
    case "done": {
      const mins = (((j.finishedAt ?? Date.now()) - j.startedAt) / 60000).toFixed(1);
      const lines = [`Done: ${what} → ${j.out} (${j.sizeMB?.toFixed(1)} MB, ${j.concurrency} thread${j.concurrency > 1 ? "s" : ""}) in ${mins} min.`];
      if (j.video) {
        const bad = j.video.issues.filter((i) => i.level !== "info");
        lines.push(`Frame check: ${j.video.frames} frames, ${bad.length ? `${bad.length} problem(s)` : "no broken frames"}.`);
        if (j.video.issues.length) lines.push(issueLines(j.video.issues));
      }
      if (j.audio) {
        lines.push(j.audio.hasAudio ? `Sound: ${j.audio.lufs ?? "–"} LUFS, peak ${j.audio.peakDb ?? "–"} dBFS.` : "Sound: none.");
        if (j.audio.issues.length) lines.push(issueLines(j.audio.issues));
      }
      return lines.join("\n");
    }
    case "failed": return `Render of ${what} failed: ${j.error}`;
    case "cancelled": return `Render of ${what} was cancelled.`;
    case "checking": return `Checking frames of ${what}: ${j.checked}/${j.total ?? "?"}${mem}`;
    case "bundling": return `Preparing ${what}…${mem}`;
    default: return `${j.status} ${what}: ${j.rendered}/${j.total ?? "?"} frames${j.eta ? `, ${j.eta} left` : ""}${mem}`;
  }
};

export const fmtAudio = (comp: string, a: AudioCheck & { made?: string }) => {
  if (!a.hasAudio) return `${comp} has no sound.`;
  const lines = [`Sound of ${comp}${a.made ? ` (analysed ${new Date(a.made).toLocaleTimeString("en-GB")})` : ""}: ${a.frames} frames, loudness ${a.lufs ?? "–"} LUFS, peak ${a.peakDb ?? "–"} dBFS.`];
  // a coarse picture of loudness: one character per second
  const per = Math.max(1, Math.round(a.fps));
  const bars = " ▁▂▃▄▅▆▇█";
  let strip = "";
  for (let i = 0; i < a.peaks.length; i += per) {
    const p = Math.max(...a.peaks.slice(i, i + per));
    strip += bars[Math.min(8, Math.round(p * 8))];
  }
  if (strip) lines.push(`Loudness per second: |${strip}|`);
  lines.push(a.issues.length ? issueLines(a.issues) : "No silent gaps or clipping.");
  return lines.join("\n");
};

export const startMcp = (projectArg?: string) => {
  const project = findProject(projectArg ?? process.env.REELNOTE_PROJECT ?? process.cwd());
  const ROOT = project?.root ?? null;
  const log = (...m: unknown[]) => process.stderr.write(`[reelnote-mcp] ${m.join(" ")}\n`);

  const app = async (): Promise<{ base: string; token: string } | null> => {
    if (!ROOT) return null;
    const f = join(dataDir(ROOT), "server.json");
    if (!existsSync(f)) return null;
    try {
      const s = JSON.parse(readFileSync(f, "utf8")) as ServerInfo;
      const base = `http://localhost:${s.port}`;
      const r = await fetch(`${base}/__rn/ping`, { signal: AbortSignal.timeout(1500) });
      return r.ok ? { base, token: s.token } : null;
    } catch {
      return null;
    }
  };
  const call = async <T = any>(path: string, init: { method?: string; body?: unknown } = {}) => {
    const a = await app();
    if (!a) throw new NotRunning();
    const r = await fetch(`${a.base}/__rn/api/${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "x-reelnote-token": a.token },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const data = (await r.json()) as T & { error?: string };
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data;
  };
  class NotRunning extends Error {
    constructor() {
      super("The ReelNote window isn't open. Ask the user to start it in the project folder: npx reelnote");
    }
  }
  const activity = (t: string) => call("activity", { body: { text: t } }).catch(() => {});

  const run = async (name: string, a: Record<string, any> = {}): Promise<Result> => {
    if (!ROOT) return err("No Remotion project found. Start the MCP server with --project <folder> or from inside the project.");
    const notes = loadNotes(ROOT);
    const dir = dataDir(ROOT);
    try {
      switch (name) {
        case "reelnote_notes": {
          const st = a.status ?? "open";
          let list = st === "all" ? notes : notes.filter((n) => n.status === st);
          if (a.composition) list = list.filter((n) => n.composition === a.composition);
          await activity(`Claude read the notes (${notes.filter((n) => n.status === "open").length} open)`);
          if (!list.length) return { content: [text(st === "open" ? "No open notes. Everything the user marked is fixed." : "No notes.")] };
          return { content: [text(`${list.length} ${st === "all" ? "" : `${st} `}note(s):\n\n${list.map(noteSummary).join("\n\n")}\n\nUse reelnote_note with an id to see the frame.`)] };
        }
        case "reelnote_note": {
          const n = notes.find((x) => x.id === Number(a.id));
          if (!n) return err(`No note #${a.id}.`);
          await activity(`Claude is looking at note #${n.id}`);
          // remember the project as it is now, so the change for this note can be shown (and undone) later
          if (n.status === "open" && !n.baseline) {
            try {
              const base = takeSnapshot(ROOT, dir);
              updateNotes(ROOT, (all) => ({ notes: all.map((x) => (x.id === n.id ? { ...x, baseline: base } : x)), result: null }));
            } catch {
              /* tracking is a bonus */
            }
          }
          const file = n.image ? join(dir, n.image) : null;
          const strip = n.strip ? join(dir, n.strip) : null;
          return { content: [
            text(noteSummary(n)), ...(file && existsSync(file) ? [image(file)] : [text("(picture missing)")]),
            ...(strip && existsSync(strip) ? [text(`Filmstrip of frames ${n.frame}–${n.endFrame} (left to right, top to bottom):`), image(strip)] : []),
          ] };
        }
        case "reelnote_strip": {
          const r = await call<{ image: string; frames: number[] }>("strip", { body: { composition: a.composition, from: Number(a.from), to: Number(a.to), count: a.count } });
          await activity(`Claude looked at frames ${a.from}–${a.to}`);
          return { content: [text(`${a.composition} · frames ${r.frames.join(", ")} (live preview, left to right, top to bottom)`), image(r.image)] };
        }
        case "reelnote_changes": {
          const n = notes.find((x) => x.id === Number(a.id));
          if (!n) return err(`No note #${a.id}.`);
          if (!n.fix) return err(`No change recorded for #${n.id}.`);
          const d = diffSnapshots(dir, n.fix.from, n.fix.to);
          return { content: [text(`Changes for #${n.id}${n.fix.undone ? " (the user UNDID these)" : ""}:\n${d.files.map((f) => `${f.path} +${f.added} −${f.removed}`).join("\n") || "no files"}\n\n${d.patch.slice(0, 20000)}`)] };
        }
        case "reelnote_render_diff": {
          const r = await call<{ frames: [number, number]; changed: { from: number; to: number; amount: number }[]; out: string; previous: string }>("render/diff", { body: { composition: a.composition } });
          const lines = [`${a.composition}: ${r.previous} → ${r.out}`];
          if (r.frames[0] !== r.frames[1]) lines.push(`Frame count changed: ${r.frames[0]} → ${r.frames[1]}`);
          lines.push(r.changed.length ? `Changed frames: ${r.changed.map((c) => (c.from === c.to ? `${c.from}` : `${c.from}–${c.to}`)).join(", ")}` : "No frames changed.");
          return { content: [text(lines.join("\n"))] };
        }
        case "reelnote_frame": {
          const r = await call<{ image: string }>("capture", { body: { composition: a.composition, frame: Number(a.frame) } });
          await activity(`Claude checked frame ${Number(a.frame).toLocaleString("en-US")}`);
          return { content: [text(`${a.composition} · frame ${Number(a.frame)} (live preview)`), image(r.image)] };
        }
        case "reelnote_compare": {
          const n = notes.find((x) => x.id === Number(a.id));
          if (!n) return err(`No note #${a.id}.`);
          const before = n.clean ?? n.image;
          const r = await call<{ image: string }>("capture", { body: { composition: n.composition, frame: n.frame } });
          await activity(`Claude compared note #${n.id} before and after`);
          const strips: Content[] = [];
          if (n.endFrame !== null && n.strip && existsSync(join(dir, n.strip))) {
            const now = await call<{ image: string }>("strip", { body: { composition: n.composition, from: n.frame, to: n.endFrame } });
            strips.push(text(`BEFORE, frames ${n.frame}–${n.endFrame}:`), image(join(dir, n.strip)), text("NOW, same frames:"), image(now.image));
          }
          return { content: [
            text(`${noteSummary(n)}\n\nBEFORE (when the note was written${n.marks.length ? "; the marks are on the picture from reelnote_note" : ""}):`),
            ...(before && existsSync(join(dir, before)) ? [image(join(dir, before))] : [text("(picture missing)")]),
            text("NOW (live preview):"), image(r.image), ...strips,
          ] };
        }
        case "reelnote_note_update": {
          const id = Number(a.id);
          if (!notes.some((n) => n.id === id)) return err(`No note #${id}.`);
          const status = a.status === "open" ? "open" : "fixed";
          // what changed in the project since Claude started on this note
          const was = notes.find((n) => n.id === id)!;
          let fix = was.fix;
          let changed = "";
          if (status === "fixed") {
            const from = was.baseline ?? was.createdSnap;
            if (from) {
              try {
                const to = takeSnapshot(ROOT, dir);
                const d = diffSnapshots(dir, from, to);
                fix = { from, to, files: d.files, at: new Date().toISOString(), undone: false };
                changed = d.files.length ? ` Recorded changes: ${d.files.map((f) => f.path).join(", ")}.` : " No file changed since you started on it.";
              } catch {
                /* tracking is a bonus */
              }
            }
          }
          const left = updateNotes(ROOT, (all) => {
            const next = all.map((n) => n.id !== id ? n : {
              ...n, status: status as "open" | "fixed", fixed: status === "fixed" ? new Date().toISOString() : null, fix,
              baseline: status === "open" ? null : n.baseline,
              replies: a.reply ? [...n.replies, { by: "claude" as const, text: String(a.reply), at: new Date().toISOString() }] : n.replies,
            });
            return { notes: next, result: next.filter((n) => n.status === "open").length };
          });
          await activity(`Claude marked #${id} ${status}`);
          return { content: [text(`Note #${id} is ${status}.${changed} ${left} open note(s) left.`)] };
        }
        case "reelnote_reply": {
          const id = Number(a.id);
          if (!notes.some((n) => n.id === id)) return err(`No note #${id}.`);
          updateNotes(ROOT, (all) => ({ notes: all.map((n) => (n.id === id ? { ...n, replies: [...n.replies, { by: "claude" as const, text: String(a.text), at: new Date().toISOString() }] } : n)), result: null }));
          await activity(`Claude replied on #${id}`);
          return { content: [text(`Replied on note #${id}. The user sees it in the ReelNote window.`)] };
        }
        case "reelnote_compositions": {
          let comps: CompositionInfo[] = [];
          try {
            comps = await call<CompositionInfo[]>("compositions");
          } catch {
            const f = join(dir, "compositions.json");
            if (existsSync(f)) comps = JSON.parse(readFileSync(f, "utf8"));
          }
          if (!comps.length) return err("No compositions known yet. Open the ReelNote window once (npx reelnote).");
          return { content: [text(comps.map((c) => `${c.folder ? `${c.folder}/` : ""}${c.id} · ${c.width}×${c.height} · ${c.fps} fps · ${c.durationInFrames} frames (${timecode(c.durationInFrames, c.fps)})${c.still ? " · still" : ""}${c.error ? ` · error: ${c.error}` : ""}`).join("\n"))] };
        }
        case "reelnote_audio": {
          const f = join(dir, "audio", `${safeName(String(a.composition))}.json`);
          if (existsSync(f) && !a.refresh) return { content: [text(fmtAudio(a.composition, JSON.parse(readFileSync(f, "utf8"))))] };
          await call("waveform", { body: { composition: a.composition } });
          await activity(`Claude asked for the sound of ${a.composition}`);
          return { content: [text(`Rendering the sound of ${a.composition} (no pictures, quick). Check reelnote_render_status, then call reelnote_audio again.`)] };
        }
        case "reelnote_render": {
          const settings = {
            codec: a.codec, scale: a.scale, crf: a.crf ?? null, concurrency: a.concurrency ?? "auto",
            range: a.from !== undefined || a.to !== undefined ? [Number(a.from ?? 0), Number(a.to ?? a.from ?? 0)] : null, muted: !!a.muted,
          };
          const st = await call<{ job: Job | null; queue: { composition: string }[]; waiting: string | null }>("render", { body: { composition: a.composition, settings } });
          await activity(`Claude queued a render of ${a.composition}`);
          const now = st.job && st.job.composition === a.composition && !["done", "failed", "cancelled"].includes(st.job.status);
          return { content: [text(now
            ? `Render started: ${st.job!.composition} → ${st.job!.out} (${st.job!.concurrency} thread${st.job!.concurrency > 1 ? "s" : ""}). Check progress with reelnote_render_status.`
            : `Queued: ${a.composition} (${st.queue.length} waiting${st.waiting ? `; ${st.waiting}` : ""}). Renders run one at a time. Check progress with reelnote_render_status.`)] };
        }
        case "reelnote_render_status": {
          const st = await call<{ job: Job | null; queue: { composition: string; kind: string }[]; waiting: string | null }>("render");
          const more = st.queue.length ? `\nNext: ${st.queue.map((x) => (x.kind === "waveform" ? `sound of ${x.composition}` : x.composition)).join(", ")}${st.waiting ? ` (${st.waiting})` : ""}` : "";
          return { content: [text(fmtJob(st.job) + more)] };
        }
        case "reelnote_report": {
          const r = await call<{ file: string }>("report", { body: { format: a.format ?? "md", lang: a.lang, status: a.status } });
          return { content: [text(`Report written: ${r.file}`)] };
        }
        default:
          return err(`Unknown tool ${name}`);
      }
    } catch (e) {
      return err(e instanceof NotRunning ? e.message : `ReelNote: ${(e as Error).message}`);
    }
  };

  const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: { id?: number | string; method?: string; params?: Record<string, any> };
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const { id, method, params } = msg;
    if (id === undefined || id === null) return; // notifications
    try {
      if (method === "initialize") {
        return send({ jsonrpc: "2.0", id, result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "reelnote", version: VERSION },
          instructions: INSTRUCTIONS,
        } });
      }
      if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
      if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      if (method === "tools/call") return send({ jsonrpc: "2.0", id, result: await run(params?.name, params?.arguments) });
      if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
      if (method === "prompts/list") return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      log((e as Error).stack ?? e);
      return send({ jsonrpc: "2.0", id, result: { content: [text(`ReelNote error: ${(e as Error).message}`)], isError: true } });
    }
  });
  rl.on("close", () => process.exit(0));
  log(`ready · v${VERSION} · project ${ROOT ?? "(none)"}`);
};
