// The ReelNote app: a small local server (127.0.0.1 only) that bundles your film, serves the review window,
// keeps notes and runs renders. The MCP server (mcp.ts) talks to it with the token in .reelnote/server.json.
// With sharing on, a second server answers on the local network for reviewers, with its own key and fewer rights.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import http from "node:http";
import os from "node:os";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { diffVideos } from "./analyze.js";
import { findBrowser, launchWindow } from "./browser.js";
import { createBundler } from "./bundler.js";
import { createCapturer } from "./capture.js";
import { findLeftovers, remotionRunning, removeLeftovers } from "./cleanup.js";
import { readMemory } from "./memory.js";
import { dataDir, loadNotes, nextId, updateNotes } from "./notes.js";
import { findEntry, findProject, findPublicDir, inside, listPublicFiles, packageVersion, resolveFromProject } from "./project.js";
import { cleanSettings, DEFAULT_SETTINGS, startJob, type RunningJob } from "./render.js";
import { writeReport, type Lang, type ReportFormat } from "./report.js";
import { diffSnapshots, pruneSnapshots, takeSnapshot, undoFix } from "./snapshots.js";
import type { CompositionInfo, Job, Note, QueueItem, RenderSettings, ServerInfo } from "./types.js";
import { CLIENT_DIR, freePort, safeName, token as makeToken, VERSION } from "./util.js";

export type AppOptions = {
  project?: string; entry?: string; port?: number; portExplicit?: boolean; window: boolean; headless: boolean; size: string; position: string; share: boolean;
};

type Role = "owner" | "reviewer";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".flac": "audio/flac", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".pdf": "application/pdf", ".wasm": "application/wasm", ".glb": "model/gltf-binary",
};

// what a reviewer on the share link may do: watch, read notes, write notes and replies
const REVIEWER_API: [string, RegExp][] = [
  ["GET", /^state$/], ["GET", /^compositions$/], ["GET", /^notes$/], ["POST", /^notes$/], ["POST", /^notes\/\d+\/replies$/],
  ["GET", /^waveform$/], ["GET", /^props$/],
];

const fail = (msg: string): never => {
  console.error(`ReelNote: ${msg}`);
  process.exit(1);
};

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const lanAddresses = () =>
  Object.values(os.networkInterfaces()).flat().filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === "IPv4" && !a.internal).map((a) => a.address);

export const startApp = async (o: AppOptions) => {
  const project = findProject(o.project ?? process.cwd()) ?? fail("no Remotion project here (no package.json that depends on remotion). Run ReelNote inside your Remotion project, or pass --project <folder>.");
  const ROOT = project.root;
  const ENTRY = findEntry(ROOT, o.entry) ?? fail(`can't find your Remotion entry point in ${ROOT} (looked for src/index.ts and Config.setEntryPoint). Pass it with --entry <file>.`);
  if (!resolveFromProject(ROOT, "@remotion/player/package.json")) {
    fail(`@remotion/player isn't installed. In your project run:  npx remotion add @remotion/player`);
  }
  const rv = packageVersion(ROOT, "remotion"), pv = packageVersion(ROOT, "@remotion/player");
  if (rv && pv && rv !== pv) console.warn(`ReelNote: remotion is ${rv} but @remotion/player is ${pv}. Use the same version: npx remotion upgrade`);
  if (rv && !rv.startsWith("4.")) console.warn(`ReelNote: made for Remotion 4 (you have ${rv}).`);

  const PUBLIC = findPublicDir(ROOT);
  const DIR = dataDir(ROOT);
  const BUILD = join(DIR, "build");
  const SERVER_FILE = join(DIR, "server.json");
  const SETTINGS_FILE = join(DIR, "settings.json");
  const RENDERS_FILE = join(DIR, "renders.json");
  const COMPS_FILE = join(DIR, "compositions.json");
  const PROPS_FILE = join(DIR, "props.json");

  // one ReelNote per project
  if (existsSync(SERVER_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(SERVER_FILE, "utf8")) as ServerInfo;
      if (prev.pid !== process.pid && pidAlive(prev.pid)) {
        const r = await fetch(`http://127.0.0.1:${prev.port}/__rn/ping`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
        if (r?.ok) fail(`already running for this project at http://localhost:${prev.port} (pid ${prev.pid}).`);
      }
    } catch {
      /* stale file */
    }
  }

  const TOKEN = makeToken();
  const readJson = <T>(f: string, def: T): T => {
    try {
      return JSON.parse(readFileSync(f, "utf8")) as T;
    } catch {
      return def;
    }
  };
  type Settings = { lang: Lang; render: RenderSettings; thumbs: boolean };
  const raw = readJson<Partial<Settings>>(SETTINGS_FILE, {});
  let settings: Settings = { lang: raw.lang === "bn" ? "bn" : "en", render: cleanSettings(raw.render ?? DEFAULT_SETTINGS), thumbs: raw.thumbs !== false };
  let compositions = readJson<CompositionInfo[]>(COMPS_FILE, []);
  const props = readJson<Record<string, Record<string, unknown>>>(PROPS_FILE, {});

  // ---------- live events (server-sent) ----------
  const clients = new Set<http.ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
    for (const c of clients) c.write(msg);
  };
  let lastBuildError: string | null = null;
  let firstBuildDone: () => void = () => {};
  const firstBuild = new Promise<void>((r) => (firstBuildDone = r));

  // ---------- build ----------
  const { ctx } = await createBundler({
    root: ROOT, entry: ENTRY, outdir: BUILD,
    onError: (text) => {
      lastBuildError = text;
      console.error(text);
      broadcast("build-error", { text });
      firstBuildDone();
    },
    onReady: (first) => {
      lastBuildError = null;
      if (!first) console.log(`ReelNote: code changed, reloading (${new Date().toLocaleTimeString()})`);
      broadcast("reload", {});
      firstBuildDone();
    },
  }).catch((e: Error) => fail(e.message));

  // ---------- frame pictures ----------
  let PORT = 0;
  let devtoolsPort: number | null = null;
  const capturer = createCapturer({ root: ROOT, devtoolsPort: () => devtoolsPort, appUrl: "http://localhost:" });

  // ---------- render queue: one at a time; the next waits while memory is critical ----------
  let running: RunningJob | null = null;
  let current: Job | null = null;
  const queue: QueueItem[] = [];
  let waiting: string | null = null;
  type RenderRecord = Omit<Job, "log" | "memory"> & { minutes: number };
  let history = readJson<RenderRecord[]>(RENDERS_FILE, []);
  const saveHistory = () => writeFileSync(RENDERS_FILE, JSON.stringify(history, null, 1));
  const slim = (j: Job | null) => (j ? { ...j, audio: j.audio ? { ...j.audio, peaks: [] } : null } : null);
  const busy = () => !!current && !["done", "failed", "cancelled"].includes(current.status);
  const renderState = () => ({ job: slim(current), queue, waiting, history: history.slice(-12).reverse() });
  let idSeq = 0;
  const pump = () => {
    if (busy() || !queue.length) return broadcast("render", renderState());
    const m = readMemory();
    if (m?.pressure === "critical") {
      waiting = `Waiting for memory · ${m.availableMB.toLocaleString("en-US")} MB free`;
      broadcast("render", renderState());
      setTimeout(pump, 3000);
      return;
    }
    waiting = null;
    const item = queue.shift()!;
    let recorded = false;
    running = startJob({
      root: ROOT, dataDir: DIR, entry: ENTRY, item,
      onUpdate: (j) => {
        current = j;
        broadcast("job", slim(j));
        if (recorded || !["done", "failed", "cancelled"].includes(j.status)) return;
        recorded = true;
        const { log: _log, memory: _mem, ...rest } = j;
        history.push({ ...rest, audio: rest.audio ? { ...rest.audio, peaks: [] } : null, minutes: ((j.finishedAt ?? Date.now()) - j.startedAt) / 60000 });
        history = history.slice(-50);
        saveHistory();
        if (j.kind === "waveform" && j.status === "done") broadcast("waveform", { composition: j.composition });
        setTimeout(pump, 300);
      },
    });
    current = running.job;
    broadcast("render", renderState());
  };
  const enqueue = (kind: QueueItem["kind"], composition: string, s: Partial<RenderSettings> | undefined) => {
    const c = compositions.find((x) => x.id === composition);
    const p = props[composition];
    const item: QueueItem = {
      id: `${Date.now().toString(36)}-${++idSeq}`, kind, composition, settings: kind === "waveform" ? { ...cleanSettings(undefined), range: null } : cleanSettings(s),
      durationInFrames: c?.durationInFrames ?? null, fps: c?.fps ?? null, added: Date.now(), props: p && Object.keys(p).length ? p : null,
    };
    queue.push(item);
    pump();
    return item;
  };

  const reveal = (file: string) => {
    if (process.platform === "darwin") spawn("open", ["-R", file], { stdio: "ignore" });
    else if (process.platform === "win32") spawn("explorer", [`/select,${file}`], { stdio: "ignore" });
    else spawn("xdg-open", [dirname(file)], { stdio: "ignore" });
  };

  // ---------- sharing with reviewers on the same network ----------
  let share: { server: http.Server; port: number; key: string } | null = null;
  const shareInfo = () => (share ? { on: true, urls: lanAddresses().map((ip) => `http://${ip}:${share!.port}/?k=${share!.key}`), port: share.port } : { on: false, urls: [], port: null });

  // ---------- http helpers ----------
  const sendFile = (req: http.IncomingMessage, res: http.ServerResponse, file: string) => {
    const st = statSync(file);
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      let start = range[1] ? Number(range[1]) : 0;
      let end = range[2] ? Number(range[2]) : st.size - 1;
      if (!range[1] && range[2]) [start, end] = [Math.max(0, st.size - Number(range[2])), st.size - 1];
      end = Math.min(end, st.size - 1);
      if (start >= st.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    createReadStream(file).pipe(res);
  };
  const json = (res: http.ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  const body = (req: http.IncomingMessage) =>
    new Promise<Record<string, any>>((resolve, reject) => {
      let s = "";
      req.on("data", (d) => {
        s += d;
        if (s.length > 2_000_000) req.destroy();
      });
      req.on("end", () => {
        try {
          resolve(s ? JSON.parse(s) : {});
        } catch (e) {
          reject(e);
        }
      });
    });

  const index = (role: Role, key: string) => {
    const boot = {
      token: key, role, version: VERSION, project: project.name, lang: settings.lang,
      staticFiles: listPublicFiles(PUBLIC, "/__rn/public"), buildError: lastBuildError,
    };
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>ReelNote · ${project.name.replace(/</g, "")}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14162b"/><circle cx="32" cy="32" r="17" fill="none" stroke="#ffc83d" stroke-width="6"/></svg>')}">
<link rel="stylesheet" href="/__rn/build/main.css"><link rel="stylesheet" href="/__rn/ui.css?v=${VERSION}"></head>
<body class="role-${role}"><div id="root"></div>
<script>
  window.__RN = ${JSON.stringify(boot).replace(/</g, "\\u003c")};
  window.remotion_staticBase = "/__rn/public";
  window.remotion_staticFiles = window.__RN.staticFiles;
  const es = new EventSource('/__rn/events?t=' + window.__RN.token);
  window.__rnEvents = es;
  es.addEventListener('reload', () => { try { window.__rnBeforeReload && window.__rnBeforeReload(); } catch (e) {} location.reload(); });
  const showError = (text) => {
    if (window.__rnShowError) return window.__rnShowError(text);
    document.body.innerHTML = '<pre style="color:#ff6b6b;background:#0e1022;margin:0;min-height:100vh;padding:28px;white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace">' + text.replace(/</g, '&lt;') + '</pre>';
  };
  es.addEventListener('build-error', (e) => showError(JSON.parse(e.data).text));
  if (window.__RN.buildError) addEventListener('DOMContentLoaded', () => showError(window.__RN.buildError));
</script>
<script type="module" src="/__rn/build/main.js"></script>
</body></html>`;
  };

  // shared by the main server and the share server
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, role: Role, key: string) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(index(role, key));
    }
    if (p === "/__rn/ping") return json(res, 200, { ok: true, version: VERSION });
    // ReelNote's own look, loaded after the film's CSS
    if (p === "/__rn/ui.css") return sendFile(req, res, join(CLIENT_DIR, "style.css"));
    if (p.startsWith("/__rn/build/")) {
      const f = inside(BUILD, p.slice("/__rn/build/".length));
      return f ? sendFile(req, res, f) : json(res, 404, { error: "not built yet" });
    }
    if (p.startsWith("/__rn/files/")) {
      const rel = p.slice("/__rn/files/".length);
      if (role === "reviewer" && !/^notes\//.test(rel)) return json(res, 403, { error: "not shared" });
      const f = inside(DIR, rel);
      return f ? sendFile(req, res, f) : json(res, 404, { error: "no such file" });
    }
    if (p.startsWith("/__rn/public/")) {
      const f = inside(PUBLIC, p.slice("/__rn/public/".length));
      return f ? sendFile(req, res, f) : json(res, 404, { error: `not in your public folder: ${p.slice(13)}` });
    }
    if (p === "/__rn/events") {
      if (url.searchParams.get("t") !== key) return json(res, 401, { error: "bad token" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": reelnote\n\n");
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (p.startsWith("/__rn/api/")) {
      // Every API call carries the session's key, so other web pages can't trigger anything.
      if (req.headers["x-reelnote-token"] !== key) return json(res, 401, { error: "bad token" });
      const route = p.slice("/__rn/api/".length);
      if (role === "reviewer" && !REVIEWER_API.some(([m, re]) => m === req.method && re.test(route))) return json(res, 403, { error: "Reviewers can watch and write notes only." });
      return await api(req, res, route, url, role);
    }
    // anything else: the project's public folder, so absolute paths like "/logo.png" work as in the Studio
    const f = inside(PUBLIC, p);
    if (f) return sendFile(req, res, f);
    return json(res, 404, { error: `not found: ${p}` });
  };

  const okHost = (host: string | undefined) => !!host && new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\]):${PORT}$`).test(host);

  const server = http.createServer(async (req, res) => {
    try {
      // Only this computer, by name: blocks other websites reaching the app through DNS tricks.
      if (!okHost(req.headers.host)) return json(res, 403, { error: "ReelNote only answers on localhost." });
      await handle(req, res, "owner", TOKEN);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    }
  });

  const cookieKey = (req: http.IncomingMessage) => req.headers.cookie?.match(/(?:^|;\s*)rn_k=(\w+)/)?.[1] ?? null;
  const shareHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!share) return json(res, 410, { error: "Sharing is off." });
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const k = url.searchParams.get("k");
      const ok = k === share.key || cookieKey(req) === share.key || req.headers["x-reelnote-token"] === share.key || url.searchParams.get("t") === share.key;
      if (!ok) {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;background:#0d0f1e;color:#e9ebff;padding:32px">
          <h2>ReelNote</h2><p>This review link isn't valid any more. Ask for a new one.</p><p>এই রিভিউ লিংকটা আর কাজ করছে না। নতুন লিংক চেয়ে নিন।</p>`);
      }
      if (k === share.key) res.setHeader("Set-Cookie", `rn_k=${share.key}; HttpOnly; SameSite=Lax; Path=/`);
      await handle(req, res, "reviewer", share.key);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    }
  };
  const startShare = async () => {
    if (share) return shareInfo();
    const key = makeToken();
    const srv = http.createServer(shareHandler);
    let port = PORT + 1;
    for (;; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          srv.once("error", reject);
          srv.listen(port, "0.0.0.0", () => {
            srv.off("error", reject);
            resolve();
          });
        });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || port > PORT + 40) throw e;
      }
    }
    share = { server: srv, port, key };
    const info = shareInfo();
    console.log(`ReelNote: sharing for review on your network:\n${info.urls.map((u) => `  ${u}`).join("\n") || "  (no network found)"}`);
    broadcast("share", info);
    return info;
  };
  const stopShare = () => {
    if (!share) return shareInfo();
    share.server.closeAllConnections?.();
    share.server.close();
    share = null;
    broadcast("share", shareInfo());
    console.log("ReelNote: sharing stopped.");
    return shareInfo();
  };

  const snap = () => {
    try {
      return takeSnapshot(ROOT, DIR);
    } catch {
      return null;
    }
  };

  const api = async (req: http.IncomingMessage, res: http.ServerResponse, route: string, url: URL, role: Role) => {
    const m = req.method ?? "GET";
    if (route === "state" && m === "GET") {
      return json(res, 200, {
        version: VERSION, role, project: { name: project.name, root: role === "owner" ? ROOT : null, entry: relative(ROOT, ENTRY) }, notes: loadNotes(ROOT), compositions,
        render: role === "owner" ? renderState() : { job: null, queue: [], waiting: null, history: [] }, memory: role === "owner" ? readMemory() : null,
        settings, props, share: role === "owner" ? shareInfo() : null, window: devtoolsPort !== null,
      });
    }
    if (route === "settings" && m === "PUT") {
      const b = await body(req);
      settings = {
        lang: b.lang === "bn" ? "bn" : b.lang === "en" ? "en" : settings.lang,
        render: b.render ? cleanSettings(b.render) : settings.render,
        thumbs: typeof b.thumbs === "boolean" ? b.thumbs : settings.thumbs,
      };
      writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      return json(res, 200, settings);
    }
    if (route === "props" && m === "GET") return json(res, 200, props);
    if (route === "props" && m === "PUT") {
      const b = await body(req);
      const id = String(b.composition ?? "");
      if (!id) return json(res, 400, { error: "Which composition?" });
      if (!b.props || typeof b.props !== "object" || !Object.keys(b.props).length) delete props[id];
      else props[id] = b.props;
      writeFileSync(PROPS_FILE, JSON.stringify(props, null, 2));
      broadcast("props", props);
      return json(res, 200, props);
    }
    if (route === "compositions" && m === "GET") return json(res, 200, compositions);
    if (route === "compositions" && m === "POST") {
      const b = await body(req);
      if (Array.isArray(b.compositions)) {
        compositions = b.compositions;
        writeFileSync(COMPS_FILE, JSON.stringify(compositions, null, 1));
      }
      return json(res, 200, { ok: true });
    }
    if (route === "notes" && m === "GET") return json(res, 200, loadNotes(ROOT));
    if (route === "notes" && m === "POST") {
      const b = await body(req);
      const comp = compositions.find((c) => c.id === b.composition);
      const id = nextId(loadNotes(ROOT)); // confirmed (or moved on) when the note is saved below
      const pad = String(id).padStart(3, "0");
      const kind = b.kind === "audio" ? "audio" : "visual";
      const marks = kind === "visual" && Array.isArray(b.marks) ? b.marks.slice(0, 50) : [];
      const frame = Math.max(0, Math.round(Number(b.frame) || 0));
      let endFrame = b.endFrame === null || b.endFrame === undefined || Number(b.endFrame) <= frame ? null : Math.round(Number(b.endFrame));
      if (endFrame !== null && comp) endFrame = Math.min(endFrame, comp.durationInFrames - 1);
      const warnings: string[] = [];
      let clean: string | null = `notes/n${pad}-clean.png`;
      let image: string | null = clean;
      let strip: string | null = null;
      // pictures are a bonus: a note is kept even if the window can't take them
      try {
        await capturer.capture({ composition: b.composition, frame, file: join(DIR, clean) });
        if (marks.length) {
          image = `notes/n${pad}.png`;
          await capturer.capture({ composition: b.composition, frame, marks, file: join(DIR, image) });
        }
        if (endFrame !== null) {
          strip = `notes/n${pad}-strip.png`;
          await capturer.strip({ composition: b.composition, from: frame, to: endFrame, file: join(DIR, strip) });
        }
      } catch (e) {
        warnings.push(`No picture: ${(e as Error).message}`);
        if (!existsSync(join(DIR, clean))) clean = image = null;
        else if (image && !existsSync(join(DIR, image))) image = clean;
        if (strip && !existsSync(join(DIR, strip))) strip = null;
      }
      const author = role === "reviewer" ? String(b.author ?? "").trim().slice(0, 40) || "Reviewer" : null;
      const p = props[String(b.composition)];
      const createdSnap = snap();
      const note = updateNotes(ROOT, (notes) => {
        const n: Note = {
          id: notes.some((x) => x.id === id) ? nextId(notes) : id, composition: String(b.composition), frame, endFrame,
          fps: Number(b.fps ?? comp?.fps ?? 30), width: Number(b.width ?? comp?.width ?? 0), height: Number(b.height ?? comp?.height ?? 0), kind,
          text: String(b.text ?? "").trim().slice(0, 4000), marks, image, clean, strip, status: "open", replies: [], created: new Date().toISOString(), fixed: null,
          author, props: p && Object.keys(p).length ? p : null, createdSnap, baseline: null, fix: null,
        };
        return { notes: [...notes, n], result: n };
      });
      broadcast("notes", loadNotes(ROOT));
      return json(res, 200, { ...note, warnings });
    }
    const one = route.match(/^notes\/(\d+)$/);
    if (one && m === "PATCH") {
      const b = await body(req);
      const id = Number(one[1]);
      const note = updateNotes(ROOT, (notes) => {
        const next = notes.map((n) => {
          if (n.id !== id) return n;
          const u = { ...n };
          if (typeof b.text === "string") u.text = b.text.trim();
          if (b.endFrame !== undefined) u.endFrame = b.endFrame === null || Number(b.endFrame) <= n.frame ? null : Math.round(Number(b.endFrame));
          if (b.status === "open" || b.status === "fixed") {
            if (b.status === "open" && n.status === "fixed") u.baseline = null; // Claude starts afresh
            u.status = b.status;
            u.fixed = b.status === "fixed" ? new Date().toISOString() : null;
          }
          return u;
        });
        return { notes: next, result: next.find((n) => n.id === id) ?? null };
      });
      broadcast("notes", loadNotes(ROOT));
      return json(res, note ? 200 : 404, note ?? { error: "no such note" });
    }
    const rep = route.match(/^notes\/(\d+)\/replies$/);
    if (rep && m === "POST") {
      const b = await body(req);
      const id = Number(rep[1]);
      const text = String(b.text ?? "").trim().slice(0, 4000);
      if (!text) return json(res, 400, { error: "Empty reply" });
      const name = role === "reviewer" ? String(b.author ?? "").trim().slice(0, 40) || "Reviewer" : undefined;
      const note = updateNotes(ROOT, (notes) => {
        const next = notes.map((n) =>
          n.id === id ? {
            ...n, replies: [...n.replies, { by: "you" as const, text, at: new Date().toISOString(), ...(name ? { name } : {}) }],
            ...(b.reopen && role === "owner" ? { status: "open" as const, fixed: null, baseline: null } : {}),
          } : n);
        return { notes: next, result: next.find((n) => n.id === id) ?? null };
      });
      broadcast("notes", loadNotes(ROOT));
      return json(res, note ? 200 : 404, note ?? { error: "no such note" });
    }
    if (one && m === "DELETE") {
      const id = Number(one[1]);
      const gone = updateNotes(ROOT, (notes) => ({ notes: notes.filter((n) => n.id !== id), result: notes.find((n) => n.id === id) ?? null }));
      for (const f of [gone?.image, gone?.clean, gone?.strip]) if (f) rmSync(join(DIR, f), { force: true });
      broadcast("notes", loadNotes(ROOT));
      return json(res, 200, { ok: true });
    }
    const ch = route.match(/^notes\/(\d+)\/changes$/);
    if (ch && m === "GET") {
      const n = loadNotes(ROOT).find((x) => x.id === Number(ch[1]));
      if (!n?.fix) return json(res, 404, { error: "Claude hasn't recorded a change for this note." });
      return json(res, 200, { ...diffSnapshots(DIR, n.fix.from, n.fix.to), undone: n.fix.undone });
    }
    const un = route.match(/^notes\/(\d+)\/undo$/);
    if (un && m === "POST") {
      const id = Number(un[1]);
      const n = loadNotes(ROOT).find((x) => x.id === id);
      if (!n?.fix) return json(res, 404, { error: "Nothing to undo." });
      if (n.fix.undone) return json(res, 409, { error: "Already undone." });
      const files = undoFix(ROOT, DIR, n.fix.from, n.fix.to);
      const note = updateNotes(ROOT, (notes) => {
        const next = notes.map((x) => x.id !== id ? x : {
          ...x, status: "open" as const, fixed: null, baseline: null, fix: { ...x.fix!, undone: true },
          replies: [...x.replies, { by: "you" as const, text: `Undid Claude's change (${files.join(", ")}).`, at: new Date().toISOString() }],
        });
        return { notes: next, result: next.find((x) => x.id === id)! };
      });
      broadcast("notes", loadNotes(ROOT));
      return json(res, 200, note);
    }
    if (route === "capture" && m === "POST") {
      const b = await body(req);
      const file = join(DIR, "frames", `${safeName(String(b.composition))}-${Math.round(Number(b.frame))}-${Date.now().toString(36)}.png`);
      await capturer.capture({ composition: String(b.composition), frame: Math.round(Number(b.frame)), file, width: b.width });
      return json(res, 200, { image: file, url: `/__rn/files/${relative(DIR, file).split("\\").join("/")}` });
    }
    if (route === "strip" && m === "POST") {
      const b = await body(req);
      const comp = compositions.find((c) => c.id === b.composition);
      const from = Math.max(0, Math.round(Number(b.from) || 0));
      const to = Math.max(from, Math.round(Number(b.to ?? from)));
      if (comp && to >= comp.durationInFrames) return json(res, 400, { error: `${comp.id} has frames 0–${comp.durationInFrames - 1}.` });
      const file = join(DIR, "frames", `${safeName(String(b.composition))}-${from}-${to}-strip-${Date.now().toString(36)}.png`);
      const r = await capturer.strip({ composition: String(b.composition), from, to, count: Math.min(16, Math.max(2, Number(b.count) || 12)), file });
      return json(res, 200, { image: r.file, frames: r.frames });
    }
    if (route === "render" && m === "GET") return json(res, 200, renderState());
    if (route === "render" && m === "POST") {
      const b = await body(req);
      if (!b.composition) return json(res, 400, { error: "Which composition?" });
      if (compositions.length && !compositions.some((c) => c.id === b.composition)) return json(res, 400, { error: `No composition called "${b.composition}". Have: ${compositions.map((c) => c.id).join(", ")}` });
      enqueue("video", String(b.composition), b.settings ?? settings.render);
      return json(res, 200, renderState());
    }
    if (route === "render/cancel" && m === "POST") {
      running?.cancel();
      return json(res, 200, { ok: true });
    }
    if (route === "render/diff" && m === "POST") {
      const b = await body(req);
      const rec = b.id ? history.find((h) => h.id === b.id)
        : [...history].reverse().find((h) => h.composition === b.composition && h.kind === "video" && h.status === "done" && h.previous);
      if (!rec) return json(res, 404, { error: "No finished render with an earlier one to compare." });
      if (!rec.previous || !existsSync(join(ROOT, rec.previous))) return json(res, 404, { error: "The earlier render isn't kept any more (cleaned up?)." });
      if (!existsSync(join(ROOT, rec.out))) return json(res, 404, { error: "This render's file is gone." });
      const d = await diffVideos({ root: ROOT, before: join(ROOT, rec.previous), after: join(ROOT, rec.out) });
      rec.diff = { ...d, at: new Date().toISOString() };
      saveHistory();
      broadcast("render", renderState());
      return json(res, 200, { ...rec.diff, composition: rec.composition, out: rec.out, previous: rec.previous });
    }
    const q = route.match(/^render\/queue\/([\w-]+)$/);
    if (q && m === "DELETE") {
      const i = queue.findIndex((x) => x.id === q[1]);
      if (i >= 0) queue.splice(i, 1);
      broadcast("render", renderState());
      return json(res, 200, renderState());
    }
    if (route === "waveform" && m === "GET") {
      const comp = url.searchParams.get("composition") ?? "";
      const f = join(DIR, "audio", `${safeName(comp)}.json`);
      return existsSync(f) ? json(res, 200, JSON.parse(readFileSync(f, "utf8"))) : json(res, 404, { error: "no waveform yet" });
    }
    if (route === "waveform" && m === "POST") {
      const b = await body(req);
      if (!b.composition) return json(res, 400, { error: "Which composition?" });
      const already = queue.some((x) => x.kind === "waveform" && x.composition === b.composition) || (busy() && current?.kind === "waveform" && current.composition === b.composition);
      if (!already) enqueue("waveform", String(b.composition), undefined);
      return json(res, 200, renderState());
    }
    if (route === "report" && m === "POST") {
      const b = await body(req);
      const format: ReportFormat = b.format === "md" || b.format === "pdf" ? b.format : "html";
      const lang: Lang = b.lang === "bn" ? "bn" : b.lang === "en" ? "en" : settings.lang;
      const notes = loadNotes(ROOT).filter((n) => (b.status === "open" || b.status === "fixed" ? n.status === b.status : true));
      const file = await writeReport({ project: project.name, notes, dataDir: DIR, format, lang, browser: findBrowser(ROOT) });
      return json(res, 200, { file, url: `/__rn/files/${relative(DIR, file).split("\\").join("/")}` });
    }
    if (route === "reveal" && m === "POST") {
      const b = await body(req);
      const raw = String(b.path ?? "");
      const f = inside(ROOT, isAbsolute(raw) ? relative(ROOT, raw) : raw);
      if (!f) return json(res, 404, { error: "That file is gone." });
      reveal(f);
      return json(res, 200, { ok: true });
    }
    if (route === "share" && m === "GET") return json(res, 200, shareInfo());
    if (route === "share" && m === "POST") {
      const b = await body(req);
      return json(res, 200, b.on ? await startShare() : stopShare());
    }
    if (route === "cleanup" && m === "GET") {
      const items = findLeftovers(DIR);
      return json(res, 200, { bytes: items.reduce((a, i) => a + i.bytes, 0), count: items.length });
    }
    if (route === "cleanup" && m === "POST") {
      if (busy() || remotionRunning()) return json(res, 409, { error: "A render is running. Clean up when it's done." });
      let freed = removeLeftovers(findLeftovers(DIR));
      // copies of the project no note needs any more
      const keep = new Set<string>();
      for (const n of loadNotes(ROOT)) for (const s of [n.createdSnap, n.baseline, n.fix?.from, n.fix?.to]) if (s) keep.add(s);
      freed += pruneSnapshots(DIR, keep);
      return json(res, 200, { freed });
    }
    if (route === "memory") return json(res, 200, readMemory());
    if (route === "activity" && m === "POST") {
      const b = await body(req);
      broadcast("activity", { text: String(b.text ?? "").slice(0, 160), at: Date.now() });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: `unknown: ${m} ${route}` });
  };

  // notes changed on disk (the MCP server marked one fixed): tell the window
  let notesTimer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  watchers.push(watch(DIR, (_ev, name) => {
    if (name !== "notes.json") return;
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => broadcast("notes", loadNotes(ROOT)), 80);
  }));
  // a file added to public/: reload so staticFile() finds it
  if (existsSync(PUBLIC)) {
    let pubTimer: NodeJS.Timeout | undefined;
    try {
      watchers.push(watch(PUBLIC, { recursive: true }, () => {
        clearTimeout(pubTimer);
        pubTimer = setTimeout(() => broadcast("reload", {}), 300);
      }));
    } catch {
      /* recursive watching not supported here */
    }
  }

  // ---------- listen ----------
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve(port);
      });
    });
  const start = o.port ?? 4545;
  for (let port = start; ; port++) {
    try {
      PORT = await listen(port);
      break;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EADDRINUSE" || o.portExplicit || port > start + 20) fail(err.code === "EADDRINUSE" ? `port ${port} is busy. Try --port ${port + 10}` : err.message);
    }
  }
  await ctx.watch();
  await firstBuild; // the window must not open before the app exists

  let browserProc: ChildProcess | null = null;
  const browser = o.window ? findBrowser(ROOT) : null;
  if (browser) devtoolsPort = await freePort(0);
  const info: ServerInfo = { port: PORT, token: TOKEN, devtoolsPort, pid: process.pid, root: ROOT, started: new Date().toISOString(), version: VERSION };
  writeFileSync(SERVER_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
  const appUrl = `http://localhost:${PORT}/`;
  console.log(`ReelNote ${VERSION} · ${project.name}\n  film:  ${relative(ROOT, ENTRY)}\n  app:   ${appUrl}\n  notes: ${join(DIR, "notes.json")}`);
  if (o.share) await startShare().catch((e: Error) => console.warn(`ReelNote: couldn't start sharing: ${e.message}`));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      const cur = JSON.parse(readFileSync(SERVER_FILE, "utf8")) as ServerInfo;
      if (cur.pid === process.pid) rmSync(SERVER_FILE, { force: true });
    } catch {
      /* already gone */
    }
    stopShare();
    running?.cancel();
    capturer.close();
    for (const w of watchers) w.close();
    try {
      browserProc?.kill();
    } catch {
      /* already closed */
    }
    await ctx.dispose().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (o.window) {
    if (!browser) {
      console.log(`  Chrome or Edge not found. Open ${appUrl} yourself; frame pictures need ReelNote's own window, so set REELNOTE_BROWSER to your browser's path.`);
    } else {
      browserProc = launchWindow({ browser, url: appUrl, devtoolsPort: devtoolsPort!, profileDir: join(DIR, "browser-profile"), headless: o.headless, size: o.size, position: o.position });
      browserProc.on("exit", () => {
        console.log("ReelNote window closed.");
        shutdown();
      });
    }
  }
  return { port: PORT, token: TOKEN, shutdown };
};
