// Checks a finished video frame by frame, and its sound.
// Picture: every frame is shrunk to 160×90 grey and compared with its neighbours.
//   flash   – a frame unlike both neighbours while the neighbours match each other (black/white flashes, corrupted frames)
//   stutter – a frame identical to the one before it while the picture moves on both sides (a dropped or repeated frame)
//   frozen  – the picture doesn't change for a long stretch (often on purpose, so only noted)
//   missing – fewer frames in the file than the composition has
// Sound: level per video frame (this is also the waveform), integrated loudness in LUFS, silent gaps and clipping.
import { spawn } from "node:child_process";
import { npx, timecode } from "./util.js";
export const W = 160, H = 90, SIZE = W * H;
export const meanAbsDiff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += Math.abs(a[i] - b[i]);
    return s / a.length;
};
const mean = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i];
    return s / a.length;
};
export const LIMITS = {
    flash: 12, // a frame must differ this much (0–255 average) from both neighbours…
    flashNeighbours: 0.5, // …while the neighbours differ less than half of that from each other
    still: 0.25, // two frames this close are the same picture (allows for compression noise)
    moving: 0.6, // the picture is moving when consecutive frames differ more than this
    frozen: 0.03,
    frozenSeconds: 3,
};
export class VideoChecker {
    fps;
    frames = 0;
    issues = [];
    win = [];
    d = []; // d[i] = difference between frame i-1 and frame i
    means = [];
    frozenFrom = null;
    constructor(fps) {
        this.fps = fps;
    }
    push(f) {
        const n = this.frames++;
        this.means[n] = mean(f);
        if (this.win.length)
            this.d[n] = meanAbsDiff(this.win[this.win.length - 1], f);
        this.win.push(f);
        if (this.win.length > 3)
            this.win.shift();
        if (n >= 2) {
            const b = n - 1, dab = this.d[n - 1], dbc = this.d[n];
            if (dab > LIMITS.flash && dbc > LIMITS.flash) {
                const dac = meanAbsDiff(this.win[0], this.win[2]);
                if (dac < LIMITS.flashNeighbours * Math.min(dab, dbc)) {
                    const m = this.means[b];
                    const kind = m < 10 ? "black-flash" : m > 245 ? "white-flash" : "flash";
                    const what = kind === "black-flash" ? "Black frame" : kind === "white-flash" ? "White frame" : "Broken frame";
                    this.issues.push({ level: "error", kind, frame: b, message: `${what} at ${b} (${timecode(b, this.fps)}): unlike the frames on both sides` });
                }
            }
        }
        if (n >= 3) {
            const b = n - 1, before = this.d[n - 2], dup = this.d[n - 1], after = this.d[n];
            if (dup < LIMITS.still && before > LIMITS.moving && after > LIMITS.moving && dup < 0.15 * Math.min(before, after)) {
                this.issues.push({ level: "warning", kind: "stutter", frame: b, message: `Frame ${b} (${timecode(b, this.fps)}) repeats frame ${b - 1} while the picture moves: a visible stutter` });
            }
        }
        if (n >= 1) {
            if (this.d[n] < LIMITS.frozen)
                this.frozenFrom ??= n - 1;
            else
                this.closeFrozen(n - 1);
        }
    }
    closeFrozen(last) {
        if (this.frozenFrom === null)
            return;
        const len = last - this.frozenFrom + 1;
        if (len >= LIMITS.frozenSeconds * this.fps) {
            this.issues.push({
                level: "info", kind: "frozen", frame: this.frozenFrom, endFrame: last,
                message: `Picture doesn't change for ${(len / this.fps).toFixed(1)} s (frames ${this.frozenFrom}–${last}). Fine if it's a hold.`,
            });
        }
        this.frozenFrom = null;
    }
    finish(expected) {
        this.closeFrozen(this.frames - 1);
        if (expected !== null && this.frames < expected) {
            this.issues.push({ level: "error", kind: "missing-frames", frame: this.frames, message: `The file has ${this.frames} frames, the composition ${expected}` });
        }
        this.issues.sort((a, b) => a.frame - b.frame);
        return { frames: this.frames, expected, issues: this.issues };
    }
}
const SILENT = Math.pow(10, -55 / 20);
const CLIP = 32700 / 32768;
export const kWeighting = (fs) => {
    let K = Math.tan((Math.PI * 1681.974450955533) / fs);
    const Q1 = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q1 + K * K;
    const shelf = { b0: (Vh + (Vb * K) / Q1 + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q1 + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q1 + K * K) / a0 };
    K = Math.tan((Math.PI * 38.13547087602444) / fs);
    const Q2 = 0.5003270373238773;
    a0 = 1 + K / Q2 + K * K;
    const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q2 + K * K) / a0 };
    return [shelf, hp];
};
export const PLATFORM_LUFS = -14; // YouTube, Spotify, TikTok aim about here
export const loudnessIssues = (lufs, peakDb, clipped) => {
    const out = [];
    if (lufs === null)
        return out;
    const down = Math.round((lufs - PLATFORM_LUFS) * 10) / 10;
    if (lufs > -9)
        out.push({ level: "warning", kind: "loudness", frame: 0, message: `Very loud: ${lufs} LUFS. YouTube and others will turn it down about ${down} dB, and it may sound squashed. Aim near ${PLATFORM_LUFS} LUFS.` });
    else if (lufs > -13)
        out.push({ level: "info", kind: "loudness", frame: 0, message: `${lufs} LUFS: YouTube will turn it down about ${down} dB (target ${PLATFORM_LUFS} LUFS).` });
    else if (lufs < -20)
        out.push({ level: "warning", kind: "loudness", frame: 0, message: `Quiet: ${lufs} LUFS. Platforms aim for ${PLATFORM_LUFS} LUFS and YouTube won't turn it up.` });
    else
        out.push({ level: "info", kind: "loudness", frame: 0, message: `${lufs} LUFS: a good level for YouTube, Spotify and TikTok (target ${PLATFORM_LUFS}).` });
    if (!clipped && peakDb !== null && peakDb > -1)
        out.push({ level: "info", kind: "loudness", frame: 0, message: `Peaks reach ${peakDb} dBFS. Keep them under −1 dBFS so they don't distort after upload.` });
    return out;
};
// Reads interleaved 16-bit samples: per-frame peak and loudness (the waveform), silent gaps, clipping,
// and integrated loudness in LUFS (BS.1770: K-weighted, 400 ms blocks, absolute and relative gates).
export class AudioAnalyzer {
    fps;
    rate;
    channels;
    peaks = [];
    rms = [];
    sumSq = 0;
    samples = 0;
    maxPeak = 0;
    cur = { peak: 0, sq: 0, n: 0 };
    carry = 0; // fractional samples per frame
    filters;
    state; // per channel: x1 x2 y1 y2 for each of the 2 filters
    sub = []; // K-weighted energy per 100 ms (summed over channels)
    subAcc = 0;
    subN = 0;
    ch = 0;
    constructor(fps, rate = 48000, channels = 2) {
        this.fps = fps;
        this.rate = rate;
        this.channels = channels;
        this.filters = kWeighting(rate);
        this.state = new Float64Array(channels * 8);
    }
    flushFrame() {
        const c = this.cur;
        this.peaks.push(Math.round(c.peak * 1000) / 1000);
        this.rms.push(c.n ? Math.sqrt(c.sq / c.n) : 0);
        this.cur = { peak: 0, sq: 0, n: 0 };
    }
    pushSamples(s) {
        const per = (this.rate / this.fps) * this.channels;
        const subLen = Math.round(this.rate / 10);
        const [f1, f2] = this.filters;
        const st = this.state;
        for (let i = 0; i < s.length; i++) {
            const v = s[i] / 32768;
            const a = Math.abs(v);
            if (a > this.cur.peak)
                this.cur.peak = a;
            if (a > this.maxPeak)
                this.maxPeak = a;
            this.cur.sq += v * v;
            this.cur.n++;
            this.sumSq += v * v;
            this.samples++;
            // K-weighting for this channel
            const o = this.ch * 8;
            const y1 = f1.b0 * v + f1.b1 * st[o] + f1.b2 * st[o + 1] - f1.a1 * st[o + 2] - f1.a2 * st[o + 3];
            st[o + 1] = st[o];
            st[o] = v;
            st[o + 3] = st[o + 2];
            st[o + 2] = y1;
            const y2 = f2.b0 * y1 + f2.b1 * st[o + 4] + f2.b2 * st[o + 5] - f2.a1 * st[o + 6] - f2.a2 * st[o + 7];
            st[o + 5] = st[o + 4];
            st[o + 4] = y1;
            st[o + 7] = st[o + 6];
            st[o + 6] = y2;
            this.subAcc += y2 * y2;
            if (++this.ch === this.channels) {
                this.ch = 0;
                if (++this.subN === subLen) {
                    this.sub.push(this.subAcc / subLen);
                    this.subAcc = 0;
                    this.subN = 0;
                }
            }
            if (this.cur.n >= Math.floor(per + this.carry) && this.ch === 0) {
                this.carry = per + this.carry - this.cur.n;
                this.flushFrame();
            }
        }
    }
    // integrated loudness, gated as BS.1770-4 describes
    lufs() {
        const blocks = [];
        for (let i = 0; i + 4 <= this.sub.length; i++)
            blocks.push((this.sub[i] + this.sub[i + 1] + this.sub[i + 2] + this.sub[i + 3]) / 4);
        const L = (z) => -0.691 + 10 * Math.log10(z);
        const abs = blocks.filter((z) => z > 0 && L(z) > -70);
        if (!abs.length)
            return null;
        const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
        const gated = abs.filter((z) => L(z) > rel);
        if (!gated.length)
            return null;
        return Math.round(L(gated.reduce((a, b) => a + b, 0) / gated.length) * 10) / 10;
    }
    finish() {
        if (this.cur.n)
            this.flushFrame();
        const issues = [];
        const loud = this.rms.map((r) => r >= SILENT);
        const first = loud.indexOf(true), last = loud.lastIndexOf(true);
        let clipped = false;
        if (first >= 0) {
            // gaps of silence between sounds (leading and trailing silence is normal)
            let from = null;
            for (let i = first; i <= last; i++) {
                if (!loud[i])
                    from ??= i;
                else if (from !== null) {
                    if (i - from >= 0.4 * this.fps) {
                        issues.push({ level: "info", kind: "silence", frame: from, endFrame: i - 1,
                            message: `Silence for ${((i - from) / this.fps).toFixed(1)} s between sounds (${timecode(from, this.fps)}–${timecode(i - 1, this.fps)})` });
                    }
                    from = null;
                }
            }
            // clipping: the peak sits at full scale for 2+ frames in a row
            let clipFrom = null;
            for (let i = 0; i <= this.peaks.length; i++) {
                const c = i < this.peaks.length && this.peaks[i] >= CLIP;
                if (c)
                    clipFrom ??= i;
                else if (clipFrom !== null) {
                    if (i - clipFrom >= 2) {
                        clipped = true;
                        issues.push({ level: "warning", kind: "clipping", frame: clipFrom, endFrame: i - 1,
                            message: `Sound clips (too loud, distorts) at ${timecode(clipFrom, this.fps)}–${timecode(i - 1, this.fps)}` });
                    }
                    clipFrom = null;
                }
            }
        }
        const db = (v) => (v > 0 ? Math.round(20 * Math.log10(v) * 10) / 10 : null);
        const lufs = this.lufs();
        const peakDb = db(this.maxPeak);
        return {
            hasAudio: true, frames: this.peaks.length, fps: this.fps, peaks: this.peaks,
            rmsDb: this.samples ? db(Math.sqrt(this.sumSq / this.samples)) : null, peakDb, lufs,
            issues: [...loudnessIssues(lufs, peakDb, clipped), ...issues],
        };
    }
}
export const remotionFfmpeg = (args, cwd) => npx(["remotion", "ffmpeg", ...args], { cwd });
export const systemFfmpeg = (args, cwd) => spawn("ffmpeg", args, { cwd });
export const checkVideo = (opts) => new Promise((resolve, reject) => {
    // Remotion's ffmpeg has no "rawvideo" muxer; image2pipe with the rawvideo codec gives the same bytes
    const ff = (opts.ffmpeg ?? remotionFfmpeg)(["-v", "error", "-i", opts.file, "-map", "0:v:0", "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "image2pipe", "-c:v", "rawvideo", "-"], opts.root);
    const checker = new VideoChecker(opts.fps);
    let buf = Buffer.alloc(0);
    ff.stdout.on("data", (chunk) => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        while (buf.length >= SIZE) {
            checker.push(Uint8Array.from(buf.subarray(0, SIZE)));
            buf = buf.subarray(SIZE);
            if (checker.frames % 120 === 0)
                opts.onProgress?.(checker.frames);
        }
    });
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(checker.finish(opts.expected)) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
});
// Remotion's ffmpeg has no raw "s16le" muxer, so the sound comes as a WAV stream: skip its header, then read samples.
export const analyzeAudio = (opts) => new Promise((resolve, reject) => {
    const ff = (opts.ffmpeg ?? remotionFfmpeg)(["-v", "error", "-i", opts.file, "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", "-flags", "+bitexact", "-map_metadata", "-1", "-f", "wav", "-"], opts.root);
    const an = new AudioAnalyzer(opts.fps);
    let head = Buffer.alloc(0); // until the "data" chunk is found
    let rest = Buffer.alloc(0);
    const feed = (chunk) => {
        const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
        const even = all.length - (all.length % 2);
        const copy = Buffer.from(all.subarray(0, even)); // aligned copy for Int16Array
        an.pushSamples(new Int16Array(copy.buffer, copy.byteOffset, even / 2));
        rest = all.subarray(even);
    };
    ff.stdout.on("data", (chunk) => {
        if (!head)
            return feed(chunk);
        head = Buffer.concat([head, chunk]);
        let off = 12; // "RIFF" size "WAVE"
        while (off + 8 <= head.length) {
            const id = head.toString("ascii", off, off + 4);
            const size = head.readUInt32LE(off + 4);
            if (id === "data") {
                const after = head.subarray(off + 8);
                head = null;
                if (after.length)
                    feed(after);
                return;
            }
            off += 8 + size + (size % 2);
        }
    });
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("close", (code) => {
        if (code === 0)
            return resolve(an.finish());
        if (/matches no streams|does not contain any stream|Stream map/i.test(err)) {
            return resolve({ hasAudio: false, frames: 0, fps: opts.fps, peaks: [], rmsDb: null, peakDb: null, lufs: null,
                issues: [{ level: "info", kind: "no-audio", frame: 0, message: "The file has no sound track" }] });
        }
        reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`));
    });
});
// frames per second of a video file, read from ffmpeg's description of it
export const probeFps = (opts) => new Promise((resolve) => {
    const ff = (opts.ffmpeg ?? remotionFfmpeg)(["-hide_banner", "-i", opts.file], opts.root);
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.stdout.resume();
    ff.on("error", () => resolve(null));
    ff.on("close", () => {
        const m = err.match(/Video:.*?(\d+(?:\.\d+)?) fps/);
        resolve(m ? Number(m[1]) : null);
    });
});
// Reads raw 160×90 grey frames from an ffmpeg process, one at a time.
class FrameReader {
    proc;
    buf = Buffer.alloc(0);
    done = false;
    waiters = [];
    error = "";
    constructor(proc) {
        this.proc = proc;
        proc.stdout.on("data", (c) => {
            this.buf = this.buf.length ? Buffer.concat([this.buf, c]) : c;
            if (this.buf.length > SIZE * 60)
                proc.stdout.pause(); // don't run ahead of the other file
            this.wake();
        });
        proc.stderr.on("data", (d) => (this.error += d));
        proc.on("close", () => {
            this.done = true;
            this.wake();
        });
        proc.on("error", (e) => {
            this.error += e.message;
            this.done = true;
            this.wake();
        });
    }
    wake() {
        const w = this.waiters;
        this.waiters = [];
        w.forEach((f) => f());
    }
    async next() {
        for (;;) {
            if (this.buf.length >= SIZE) {
                const f = Uint8Array.from(this.buf.subarray(0, SIZE));
                this.buf = this.buf.subarray(SIZE);
                if (this.buf.length < SIZE * 30)
                    this.proc.stdout.resume();
                return f;
            }
            if (this.done)
                return null;
            this.proc.stdout.resume();
            await new Promise((r) => this.waiters.push(r));
        }
    }
}
const greyFrames = (ff, root, file) => ff(["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "image2pipe", "-c:v", "rawvideo", "-"], root);
export const CHANGED = 1.2; // average difference (0–255) above which a frame counts as changed (compression noise is lower)
// Compares two renders frame by frame and returns the stretches that changed.
export const diffVideos = async (opts) => {
    const ff = opts.ffmpeg ?? remotionFfmpeg;
    const a = new FrameReader(greyFrames(ff, opts.root, opts.before));
    const b = new FrameReader(greyFrames(ff, opts.root, opts.after));
    const changed = [];
    let i = 0, na = 0, nb = 0;
    for (;;) {
        const [fa, fb] = await Promise.all([a.next(), b.next()]);
        if (fa)
            na++;
        if (fb)
            nb++;
        if (!fa || !fb) {
            // drain whichever is longer, just to count
            while (fa && (await a.next()))
                na++;
            while (fb && (await b.next()))
                nb++;
            break;
        }
        const d = meanAbsDiff(fa, fb);
        if (d > CHANGED) {
            const last = changed[changed.length - 1];
            if (last && i - last.to <= 2) {
                last.to = i;
                last.amount = Math.max(last.amount, Math.round(d * 10) / 10);
            }
            else
                changed.push({ from: i, to: i, amount: Math.round(d * 10) / 10 });
        }
        i++;
    }
    if (!na || !nb)
        throw new Error(`Couldn't read the videos: ${(a.error || b.error).slice(-300)}`);
    return { frames: [na, nb], changed };
};
