// "Render once": the real Remotion CLI with safe settings, live progress and memory, then the frame and sound check.
// A "waveform" job renders only the sound (fast, no pictures) so the timeline can show it.
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { analyzeAudio, checkVideo } from "./analyze.js";
import { autoConcurrency, readMemory } from "./memory.js";
import { killTree, npx, safeName } from "./util.js";
export const EXT = { h264: "mp4", h265: "mp4", vp9: "webm", prores: "mov", gif: "gif" };
export const DEFAULT_SETTINGS = { codec: "h264", scale: 1, crf: null, concurrency: "auto", range: null, muted: false };
export const cleanSettings = (s) => {
    const codec = s?.codec && s.codec in EXT ? s.codec : "h264";
    const scale = Math.min(4, Math.max(0.1, Number(s?.scale) || 1));
    const crf = s?.crf === null || s?.crf === undefined || s.crf === "" ? null : Math.round(Math.min(63, Math.max(0, Number(s.crf))));
    const conc = s?.concurrency === "auto" || s?.concurrency === undefined ? "auto" : Math.round(Math.min(16, Math.max(1, Number(s.concurrency) || 1)));
    const range = Array.isArray(s?.range) && s.range.length === 2 ? [Math.max(0, Math.round(s.range[0])), Math.max(0, Math.round(s.range[1]))].sort((a, b) => a - b) : null;
    return { codec, scale, crf: codec === "gif" || codec === "prores" ? null : crf, concurrency: conc, range, muted: !!s?.muted };
};
export const outputPath = (root, dataDir, item) => {
    if (item.kind === "waveform")
        return join(dataDir, "audio", `${safeName(item.composition)}.wav`);
    const s = item.settings;
    const suffix = s.range ? `-${s.range[0]}-${s.range[1]}` : "";
    return join(root, "out", `${safeName(item.composition)}${suffix}.${EXT[s.codec]}`);
};
export const renderArgs = (entry, item, out, concurrency, propsFile = null) => {
    const s = item.settings;
    const args = ["remotion", "render", entry, item.composition, out, `--concurrency=${concurrency}`, "--log=info"];
    if (propsFile)
        args.push(`--props=${propsFile}`);
    if (item.kind === "waveform") {
        args.push("--codec=wav");
    }
    else {
        args.push(`--codec=${s.codec}`);
        if (s.scale !== 1)
            args.push(`--scale=${s.scale}`);
        if (s.crf !== null)
            args.push(`--crf=${s.crf}`);
        if (s.muted)
            args.push("--muted");
    }
    if (s.range)
        args.push(`--frames=${s.range[0]}-${s.range[1]}`);
    return args;
};
// Remotion's progress lines, e.g. "Rendered 120/900, time remaining: 1m 20s" and "Encoded 300/900"
export const parseProgress = (line) => {
    const r = line.match(/Rendered (\d+)\/(\d+)(?:,\s*time remaining:\s*(.+))?/i);
    if (r)
        return { kind: "rendered", done: Number(r[1]), total: Number(r[2]), eta: r[3]?.trim() ?? null };
    const e = line.match(/Encoded (\d+)\/(\d+)/i);
    if (e)
        return { kind: "encoded", done: Number(e[1]), total: Number(e[2]), eta: null };
    if (/bundling|bundled/i.test(line))
        return { kind: "bundling", done: 0, total: 0, eta: null };
    return null;
};
export const startJob = (opts) => {
    const { root, dataDir, entry, item } = opts;
    const out = outputPath(root, dataDir, item);
    mkdirSync(join(out, ".."), { recursive: true });
    // keep the render this one replaces, so the two can be compared
    let previous = null;
    if (item.kind === "video" && existsSync(out)) {
        const prevDir = join(dataDir, "previous");
        mkdirSync(prevDir, { recursive: true });
        const keep = join(prevDir, out.split(/[\\/]/).pop());
        try {
            renameSync(out, keep);
        }
        catch {
            copyFileSync(out, keep); // another drive
        }
        previous = relative(root, keep);
    }
    let propsFile = null;
    if (item.props && Object.keys(item.props).length) {
        propsFile = join(dataDir, `props-${safeName(item.composition)}.json`);
        writeFileSync(propsFile, JSON.stringify(item.props));
    }
    const mem = readMemory();
    const concurrency = item.settings.concurrency === "auto" ? autoConcurrency(mem) : item.settings.concurrency;
    const total = item.durationInFrames === null ? null : item.settings.range ? item.settings.range[1] - item.settings.range[0] + 1 : item.durationInFrames;
    const job = {
        id: item.id, kind: item.kind, composition: item.composition, settings: item.settings, concurrency, out: relative(root, out),
        status: "bundling", rendered: 0, encoded: 0, total, checked: 0, eta: null, startedAt: Date.now(), finishedAt: null,
        memory: mem, minAvailableMB: mem?.availableMB ?? null, maxSwapGB: mem?.swapUsedGB ?? null, sizeMB: null, video: null, audio: null, error: null, log: [], previous, diff: null,
    };
    let cancelled = false;
    const update = () => opts.onUpdate({ ...job, log: job.log.slice(-8) });
    const memTimer = setInterval(() => {
        const m = readMemory();
        if (!m)
            return;
        job.memory = m;
        job.minAvailableMB = Math.min(job.minAvailableMB ?? m.availableMB, m.availableMB);
        if (m.swapUsedGB !== null)
            job.maxSwapGB = Math.max(job.maxSwapGB ?? 0, m.swapUsedGB);
        update();
    }, 2000);
    const proc = npx(renderArgs(entry, item, out, concurrency, propsFile), { cwd: root, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    const onText = (text) => {
        for (const raw of text.split(/[\r\n]+/)) {
            const line = raw.trim();
            if (!line)
                continue;
            job.log.push(line);
            if (job.log.length > 300)
                job.log.shift();
            const p = parseProgress(line);
            if (p?.kind === "rendered") {
                job.status = "rendering";
                job.rendered = p.done;
                job.total = p.total;
                job.eta = p.eta;
            }
            else if (p?.kind === "encoded") {
                job.encoded = p.done;
                job.total ??= p.total;
                if (job.rendered >= (job.total ?? Infinity))
                    job.status = "encoding";
            }
        }
        update();
    };
    proc.stdout.on("data", (d) => onText(d.toString()));
    proc.stderr.on("data", (d) => onText(d.toString()));
    proc.on("error", (e) => {
        job.log.push(`Could not start the Remotion CLI: ${e.message}`);
    });
    proc.on("close", async (code) => {
        clearInterval(memTimer);
        if (cancelled || code !== 0 || !existsSync(out)) {
            job.status = cancelled ? "cancelled" : "failed";
            job.error = cancelled ? null : job.log.filter((l) => /error|failed|cannot|could not/i.test(l)).slice(-4).join("\n") || job.log.slice(-4).join("\n") || `remotion exited with code ${code}`;
            job.finishedAt = Date.now();
            return update();
        }
        job.status = "checking";
        job.rendered = job.total ?? job.rendered;
        update();
        const fps = item.fps ?? 30;
        try {
            job.sizeMB = statSync(out).size / 1048576;
            if (item.kind === "waveform") {
                job.audio = await analyzeAudio({ root, file: out, fps });
                writeFileSync(join(dataDir, "audio", `${safeName(item.composition)}.json`), JSON.stringify({ composition: item.composition, made: new Date().toISOString(), ...job.audio }));
            }
            else {
                job.video = await checkVideo({ root, file: out, fps, expected: job.total, onProgress: (n) => { job.checked = n; update(); } });
                if (item.settings.codec !== "gif" && !item.settings.muted)
                    job.audio = await analyzeAudio({ root, file: out, fps });
            }
            job.status = "done";
        }
        catch (e) {
            job.status = "failed";
            job.error = `Check failed: ${e.message}`;
        }
        job.finishedAt = Date.now();
        update();
    });
    return {
        job,
        cancel: () => {
            cancelled = true;
            killTree(proc);
        },
    };
};
