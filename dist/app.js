import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { findBrowser, launchWindow } from "./browser.js";
import { createBundler } from "./bundler.js";
import { createCapturer } from "./capture.js";
import { findLeftovers, remotionRunning, removeLeftovers } from "./cleanup.js";
import { readMemory } from "./memory.js";
import { dataDir, loadNotes, nextId, updateNotes } from "./notes.js";
import { findEntry, findProject, findPublicDir, inside, listPublicFiles, packageVersion, resolveFromProject } from "./project.js";
import { cleanSettings, DEFAULT_SETTINGS, startJob } from "./render.js";
import { writeReport } from "./report.js";
import { freePort, safeName, token as makeToken, VERSION } from "./util.js";
const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg",
    ".flac": "audio/flac", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".woff": "font/woff",
    ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".pdf": "application/pdf", ".wasm": "application/wasm", ".glb": "model/gltf-binary",
};
const fail = (msg) => {
    console.error(`ReelNote: ${msg}`);
    process.exit(1);
};
const pidAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
};
export const startApp = async (o) => {
    const project = findProject(o.project ?? process.cwd()) ?? fail("no Remotion project here (no package.json that depends on remotion). Run ReelNote inside your Remotion project, or pass --project <folder>.");
    const ROOT = project.root;
    const ENTRY = findEntry(ROOT, o.entry) ?? fail(`can't find your Remotion entry point in ${ROOT} (looked for src/index.ts and Config.setEntryPoint). Pass it with --entry <file>.`);
    if (!resolveFromProject(ROOT, "@remotion/player/package.json")) {
        fail(`@remotion/player isn't installed. In your project run:  npx remotion add @remotion/player`);
    }
    const rv = packageVersion(ROOT, "remotion"), pv = packageVersion(ROOT, "@remotion/player");
    if (rv && pv && rv !== pv)
        console.warn(`ReelNote: remotion is ${rv} but @remotion/player is ${pv}. Use the same version: npx remotion upgrade`);
    if (rv && !rv.startsWith("4."))
        console.warn(`ReelNote: made for Remotion 4 (you have ${rv}).`);
    const PUBLIC = findPublicDir(ROOT);
    const DIR = dataDir(ROOT);
    const BUILD = join(DIR, "build");
    const SERVER_FILE = join(DIR, "server.json");
    const SETTINGS_FILE = join(DIR, "settings.json");
    const RENDERS_FILE = join(DIR, "renders.json");
    const COMPS_FILE = join(DIR, "compositions.json");
    // one ReelNote per project
    if (existsSync(SERVER_FILE)) {
        try {
            const prev = JSON.parse(readFileSync(SERVER_FILE, "utf8"));
            if (prev.pid !== process.pid && pidAlive(prev.pid)) {
                const r = await fetch(`http://127.0.0.1:${prev.port}/__rn/ping`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
                if (r?.ok)
                    fail(`already running for this project at http://localhost:${prev.port} (pid ${prev.pid}).`);
            }
        }
        catch {
            /* stale file */
        }
    }
    const TOKEN = makeToken();
    const readJson = (f, def) => {
        try {
            return JSON.parse(readFileSync(f, "utf8"));
        }
        catch {
            return def;
        }
    };
    let settings = readJson(SETTINGS_FILE, { lang: "en", render: DEFAULT_SETTINGS });
    settings = { lang: settings.lang === "bn" ? "bn" : "en", render: cleanSettings(settings.render) };
    let compositions = readJson(COMPS_FILE, []);
    // ---------- live events (server-sent) ----------
    const clients = new Set();
    const broadcast = (event, data) => {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
        for (const c of clients)
            c.write(msg);
    };
    let lastBuildError = null;
    let firstBuildDone = () => { };
    const firstBuild = new Promise((r) => (firstBuildDone = r));
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
            if (!first)
                console.log(`ReelNote: code changed, reloading (${new Date().toLocaleTimeString()})`);
            broadcast("reload", {});
            firstBuildDone();
        },
    }).catch((e) => fail(e.message));
    // ---------- frame pictures ----------
    let PORT = 0;
    let devtoolsPort = null;
    const capturer = createCapturer({ root: ROOT, devtoolsPort: () => devtoolsPort, appUrl: "http://localhost:" });
    // ---------- render queue: one at a time; the next waits while memory is critical ----------
    let running = null;
    let current = null;
    const queue = [];
    let waiting = null;
    let history = readJson(RENDERS_FILE, []);
    const slim = (j) => (j ? { ...j, audio: j.audio ? { ...j.audio, peaks: [] } : null } : null);
    const busy = () => !!current && !["done", "failed", "cancelled"].includes(current.status);
    const renderState = () => ({ job: slim(current), queue, waiting, history: history.slice(-12).reverse() });
    let idSeq = 0;
    const pump = () => {
        if (busy() || !queue.length)
            return broadcast("render", renderState());
        const m = readMemory();
        if (m?.pressure === "critical") {
            waiting = `Waiting for memory · ${m.availableMB.toLocaleString("en-US")} MB free`;
            broadcast("render", renderState());
            setTimeout(pump, 3000);
            return;
        }
        waiting = null;
        const item = queue.shift();
        let recorded = false;
        running = startJob({
            root: ROOT, dataDir: DIR, entry: ENTRY, item,
            onUpdate: (j) => {
                current = j;
                broadcast("job", slim(j));
                if (recorded || !["done", "failed", "cancelled"].includes(j.status))
                    return;
                recorded = true;
                const { log: _log, memory: _mem, ...rest } = j;
                history.push({ ...rest, audio: rest.audio ? { ...rest.audio, peaks: [] } : null, minutes: ((j.finishedAt ?? Date.now()) - j.startedAt) / 60000 });
                history = history.slice(-50);
                writeFileSync(RENDERS_FILE, JSON.stringify(history, null, 1));
                if (j.kind === "waveform" && j.status === "done")
                    broadcast("waveform", { composition: j.composition });
                setTimeout(pump, 300);
            },
        });
        current = running.job;
        broadcast("render", renderState());
    };
    const enqueue = (kind, composition, s) => {
        const c = compositions.find((x) => x.id === composition);
        const item = {
            id: `${Date.now().toString(36)}-${++idSeq}`, kind, composition, settings: kind === "waveform" ? { ...cleanSettings(undefined), range: null } : cleanSettings(s),
            durationInFrames: c?.durationInFrames ?? null, fps: c?.fps ?? null, added: Date.now(),
        };
        queue.push(item);
        pump();
        return item;
    };
    const reveal = (file) => {
        if (process.platform === "darwin")
            spawn("open", ["-R", file], { stdio: "ignore" });
        else if (process.platform === "win32")
            spawn("explorer", [`/select,${file}`], { stdio: "ignore" });
        else
            spawn("xdg-open", [dirname(file)], { stdio: "ignore" });
    };
    // ---------- http helpers ----------
    const sendFile = (req, res, file) => {
        const st = statSync(file);
        const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
        const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
        if (range) {
            let start = range[1] ? Number(range[1]) : 0;
            let end = range[2] ? Number(range[2]) : st.size - 1;
            if (!range[1] && range[2])
                [start, end] = [Math.max(0, st.size - Number(range[2])), st.size - 1];
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
    const json = (res, code, data) => {
        res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
    };
    const body = (req) => new Promise((resolve, reject) => {
        let s = "";
        req.on("data", (d) => {
            s += d;
            if (s.length > 2_000_000)
                req.destroy();
        });
        req.on("end", () => {
            try {
                resolve(s ? JSON.parse(s) : {});
            }
            catch (e) {
                reject(e);
            }
        });
    });
    const index = () => {
        const boot = {
            token: TOKEN, version: VERSION, project: project.name, lang: settings.lang,
            staticFiles: listPublicFiles(PUBLIC, "/__rn/public"), buildError: lastBuildError,
        };
        return `<!doctype html>
<html><head><meta charset="utf-8"><title>ReelNote · ${project.name.replace(/</g, "")}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14162b"/><circle cx="32" cy="32" r="17" fill="none" stroke="#ffc83d" stroke-width="6"/></svg>')}">
<link rel="stylesheet" href="/__rn/build/main.css"></head>
<body><div id="root"></div>
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
    const okHost = (host) => !!host && new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\]):${PORT}$`).test(host);
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
        const p = url.pathname;
        try {
            // Only this computer, by name: blocks other websites reaching the app through DNS tricks.
            if (!okHost(req.headers.host))
                return json(res, 403, { error: "ReelNote only answers on localhost." });
            if (p === "/" || p === "/index.html") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                return res.end(index());
            }
            if (p === "/__rn/ping")
                return json(res, 200, { ok: true, version: VERSION });
            if (p.startsWith("/__rn/build/")) {
                const f = inside(BUILD, p.slice("/__rn/build/".length));
                return f ? sendFile(req, res, f) : json(res, 404, { error: "not built yet" });
            }
            if (p.startsWith("/__rn/files/")) {
                const f = inside(DIR, p.slice("/__rn/files/".length));
                return f ? sendFile(req, res, f) : json(res, 404, { error: "no such file" });
            }
            if (p.startsWith("/__rn/public/")) {
                const f = inside(PUBLIC, p.slice("/__rn/public/".length));
                return f ? sendFile(req, res, f) : json(res, 404, { error: `not in your public folder: ${p.slice(13)}` });
            }
            if (p === "/__rn/events") {
                if (url.searchParams.get("t") !== TOKEN)
                    return json(res, 401, { error: "bad token" });
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
                // Every API call carries the session token, so other web pages can't trigger anything.
                if (req.headers["x-reelnote-token"] !== TOKEN)
                    return json(res, 401, { error: "bad token" });
                return await api(req, res, p.slice("/__rn/api/".length), url);
            }
            // anything else: the project's public folder, so absolute paths like "/logo.png" work as in the Studio
            const f = inside(PUBLIC, p);
            if (f)
                return sendFile(req, res, f);
            return json(res, 404, { error: `not found: ${p}` });
        }
        catch (e) {
            console.error(e);
            return json(res, 500, { error: e.message });
        }
    });
    const noteById = (id) => loadNotes(ROOT).find((n) => n.id === id) ?? null;
    const api = async (req, res, route, url) => {
        const m = req.method ?? "GET";
        if (route === "state" && m === "GET") {
            return json(res, 200, {
                version: VERSION, project: { name: project.name, root: ROOT, entry: relative(ROOT, ENTRY) }, notes: loadNotes(ROOT), compositions,
                render: renderState(), memory: readMemory(), settings, window: devtoolsPort !== null,
            });
        }
        if (route === "settings" && m === "PUT") {
            const b = await body(req);
            settings = { lang: b.lang === "bn" ? "bn" : b.lang === "en" ? "en" : settings.lang, render: b.render ? cleanSettings(b.render) : settings.render };
            writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
            return json(res, 200, settings);
        }
        if (route === "compositions" && m === "GET")
            return json(res, 200, compositions);
        if (route === "compositions" && m === "POST") {
            const b = await body(req);
            if (Array.isArray(b.compositions)) {
                compositions = b.compositions;
                writeFileSync(COMPS_FILE, JSON.stringify(compositions, null, 1));
            }
            return json(res, 200, { ok: true });
        }
        if (route === "notes" && m === "GET")
            return json(res, 200, loadNotes(ROOT));
        if (route === "notes" && m === "POST") {
            const b = await body(req);
            const comp = compositions.find((c) => c.id === b.composition);
            const id = nextId(loadNotes(ROOT)); // confirmed (or moved on) when the note is saved below
            const pad = String(id).padStart(3, "0");
            const kind = b.kind === "audio" ? "audio" : "visual";
            const marks = kind === "visual" && Array.isArray(b.marks) ? b.marks : [];
            const frame = Math.max(0, Math.round(Number(b.frame) || 0));
            const endFrame = b.endFrame === null || b.endFrame === undefined || Number(b.endFrame) === frame ? null : Math.round(Number(b.endFrame));
            const clean = `notes/n${pad}-clean.png`;
            await capturer.capture({ composition: b.composition, frame, file: join(DIR, clean) });
            let image = clean;
            if (marks.length) {
                image = `notes/n${pad}.png`;
                await capturer.capture({ composition: b.composition, frame, marks, file: join(DIR, image) });
            }
            const note = updateNotes(ROOT, (notes) => {
                const n = {
                    id: notes.some((x) => x.id === id) ? nextId(notes) : id, composition: String(b.composition), frame,
                    endFrame: endFrame !== null && endFrame < frame ? null : endFrame, fps: Number(b.fps ?? comp?.fps ?? 30),
                    width: Number(b.width ?? comp?.width ?? 0), height: Number(b.height ?? comp?.height ?? 0), kind,
                    text: String(b.text ?? "").trim(), marks, image, clean, status: "open", replies: [], created: new Date().toISOString(), fixed: null,
                };
                return { notes: [...notes, n], result: n };
            });
            broadcast("notes", loadNotes(ROOT));
            return json(res, 200, note);
        }
        const one = route.match(/^notes\/(\d+)$/);
        if (one && m === "PATCH") {
            const b = await body(req);
            const id = Number(one[1]);
            const note = updateNotes(ROOT, (notes) => {
                const next = notes.map((n) => {
                    if (n.id !== id)
                        return n;
                    const u = { ...n };
                    if (typeof b.text === "string")
                        u.text = b.text.trim();
                    if (b.endFrame !== undefined)
                        u.endFrame = b.endFrame === null || Number(b.endFrame) <= n.frame ? null : Math.round(Number(b.endFrame));
                    if (b.status === "open" || b.status === "fixed") {
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
            const text = String(b.text ?? "").trim();
            if (!text)
                return json(res, 400, { error: "Empty reply" });
            const note = updateNotes(ROOT, (notes) => {
                const next = notes.map((n) => n.id === id ? { ...n, replies: [...n.replies, { by: "you", text, at: new Date().toISOString() }], ...(b.reopen ? { status: "open", fixed: null } : {}) } : n);
                return { notes: next, result: next.find((n) => n.id === id) ?? null };
            });
            broadcast("notes", loadNotes(ROOT));
            return json(res, note ? 200 : 404, note ?? { error: "no such note" });
        }
        if (one && m === "DELETE") {
            const id = Number(one[1]);
            const gone = updateNotes(ROOT, (notes) => ({ notes: notes.filter((n) => n.id !== id), result: notes.find((n) => n.id === id) ?? null }));
            for (const f of [gone?.image, gone?.clean])
                if (f)
                    rmSync(join(DIR, f), { force: true });
            broadcast("notes", loadNotes(ROOT));
            return json(res, 200, { ok: true });
        }
        if (route === "capture" && m === "POST") {
            const b = await body(req);
            const file = join(DIR, "frames", `${safeName(String(b.composition))}-${Math.round(Number(b.frame))}-${Date.now().toString(36)}.png`);
            await capturer.capture({ composition: String(b.composition), frame: Math.round(Number(b.frame)), file, width: b.width });
            return json(res, 200, { image: file, url: `/__rn/files/${relative(DIR, file).split("\\").join("/")}` });
        }
        if (route === "render" && m === "GET")
            return json(res, 200, renderState());
        if (route === "render" && m === "POST") {
            const b = await body(req);
            if (!b.composition)
                return json(res, 400, { error: "Which composition?" });
            if (compositions.length && !compositions.some((c) => c.id === b.composition))
                return json(res, 400, { error: `No composition called "${b.composition}". Have: ${compositions.map((c) => c.id).join(", ")}` });
            enqueue("video", String(b.composition), b.settings ?? settings.render);
            return json(res, 200, renderState());
        }
        if (route === "render/cancel" && m === "POST") {
            running?.cancel();
            return json(res, 200, { ok: true });
        }
        const q = route.match(/^render\/queue\/([\w-]+)$/);
        if (q && m === "DELETE") {
            const i = queue.findIndex((x) => x.id === q[1]);
            if (i >= 0)
                queue.splice(i, 1);
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
            if (!b.composition)
                return json(res, 400, { error: "Which composition?" });
            const already = queue.some((x) => x.kind === "waveform" && x.composition === b.composition) || (busy() && current?.kind === "waveform" && current.composition === b.composition);
            if (!already)
                enqueue("waveform", String(b.composition), undefined);
            return json(res, 200, renderState());
        }
        if (route === "report" && m === "POST") {
            const b = await body(req);
            const format = b.format === "md" || b.format === "pdf" ? b.format : "html";
            const lang = b.lang === "bn" ? "bn" : b.lang === "en" ? "en" : settings.lang;
            const notes = loadNotes(ROOT).filter((n) => (b.status === "open" || b.status === "fixed" ? n.status === b.status : true));
            const file = await writeReport({ project: project.name, notes, dataDir: DIR, format, lang, browser: findBrowser(ROOT) });
            return json(res, 200, { file, url: `/__rn/files/${relative(DIR, file).split("\\").join("/")}` });
        }
        if (route === "reveal" && m === "POST") {
            const b = await body(req);
            const raw = String(b.path ?? "");
            const f = inside(ROOT, isAbsolute(raw) ? relative(ROOT, raw) : raw);
            if (!f)
                return json(res, 404, { error: "That file is gone." });
            reveal(f);
            return json(res, 200, { ok: true });
        }
        if (route === "cleanup" && m === "GET") {
            const items = findLeftovers(DIR);
            return json(res, 200, { bytes: items.reduce((a, i) => a + i.bytes, 0), count: items.length });
        }
        if (route === "cleanup" && m === "POST") {
            if (busy() || remotionRunning())
                return json(res, 409, { error: "A render is running. Clean up when it's done." });
            return json(res, 200, { freed: removeLeftovers(findLeftovers(DIR)) });
        }
        if (route === "memory")
            return json(res, 200, readMemory());
        if (route === "activity" && m === "POST") {
            const b = await body(req);
            broadcast("activity", { text: String(b.text ?? "").slice(0, 160), at: Date.now() });
            return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: `unknown: ${m} ${route}` });
    };
    // notes changed on disk (the MCP server marked one fixed): tell the window
    let notesTimer;
    const watchers = [];
    watchers.push(watch(DIR, (_ev, name) => {
        if (name !== "notes.json")
            return;
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => broadcast("notes", loadNotes(ROOT)), 80);
    }));
    // a file added to public/: reload so staticFile() finds it
    if (existsSync(PUBLIC)) {
        let pubTimer;
        try {
            watchers.push(watch(PUBLIC, { recursive: true }, () => {
                clearTimeout(pubTimer);
                pubTimer = setTimeout(() => broadcast("reload", {}), 300);
            }));
        }
        catch {
            /* recursive watching not supported here */
        }
    }
    // ---------- listen ----------
    const listen = (port) => new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            resolve(port);
        });
    });
    const start = o.port ?? 4545;
    for (let port = start;; port++) {
        try {
            PORT = await listen(port);
            break;
        }
        catch (e) {
            const err = e;
            if (err.code !== "EADDRINUSE" || o.portExplicit || port > start + 20)
                fail(err.code === "EADDRINUSE" ? `port ${port} is busy. Try --port ${port + 10}` : err.message);
        }
    }
    await ctx.watch();
    await firstBuild; // the window must not open before the app exists
    let browserProc = null;
    const browser = o.window ? findBrowser(ROOT) : null;
    if (browser)
        devtoolsPort = await freePort(0);
    const info = { port: PORT, token: TOKEN, devtoolsPort, pid: process.pid, root: ROOT, started: new Date().toISOString(), version: VERSION };
    writeFileSync(SERVER_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
    const appUrl = `http://localhost:${PORT}/`;
    console.log(`ReelNote ${VERSION} · ${project.name}\n  film:  ${relative(ROOT, ENTRY)}\n  app:   ${appUrl}\n  notes: ${join(DIR, "notes.json")}`);
    let stopping = false;
    const shutdown = async () => {
        if (stopping)
            return;
        stopping = true;
        try {
            const cur = JSON.parse(readFileSync(SERVER_FILE, "utf8"));
            if (cur.pid === process.pid)
                rmSync(SERVER_FILE, { force: true });
        }
        catch {
            /* already gone */
        }
        running?.cancel();
        capturer.close();
        for (const w of watchers)
            w.close();
        try {
            browserProc?.kill();
        }
        catch {
            /* already closed */
        }
        await ctx.dispose().catch(() => { });
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    if (o.window) {
        if (!browser) {
            console.log(`  Chrome or Edge not found. Open ${appUrl} yourself; frame pictures need ReelNote's own window, so set REELNOTE_BROWSER to your browser's path.`);
        }
        else {
            browserProc = launchWindow({ browser, url: appUrl, devtoolsPort: devtoolsPort, profileDir: join(DIR, "browser-profile"), headless: o.headless, size: o.size, position: o.position });
            browserProc.on("exit", () => {
                console.log("ReelNote window closed.");
                shutdown();
            });
        }
    }
    return { port: PORT, token: TOKEN, shutdown };
};
