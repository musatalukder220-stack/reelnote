// Checks a finished video frame by frame, and its sound.
// Picture: every frame is shrunk to 160×90 grey and compared with its neighbours.
//   flash   – a frame unlike both neighbours while the neighbours match each other (black/white flashes, corrupted frames)
//   stutter – a frame identical to the one before it while the picture moves on both sides (a dropped or repeated frame)
//   frozen  – the picture doesn't change for a long stretch (often on purpose, so only noted)
//   missing – fewer frames in the file than the composition has
// Sound: loudness per video frame (this is also the waveform), silent gaps between sounds, and clipping.
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
export class AudioAnalyzer {
    fps;
    rate;
    peaks = [];
    rms = [];
    sumSq = 0;
    samples = 0;
    maxPeak = 0;
    cur = { peak: 0, sq: 0, n: 0 };
    carry = 0; // fractional samples per frame
    constructor(fps, rate = 8000) {
        this.fps = fps;
        this.rate = rate;
    }
    flushFrame() {
        const c = this.cur;
        this.peaks.push(Math.round(c.peak * 1000) / 1000);
        this.rms.push(c.n ? Math.sqrt(c.sq / c.n) : 0);
        this.cur = { peak: 0, sq: 0, n: 0 };
    }
    pushSamples(s) {
        const per = this.rate / this.fps;
        for (let i = 0; i < s.length; i++) {
            const v = Math.abs(s[i]) / 32768;
            if (v > this.cur.peak)
                this.cur.peak = v;
            if (v > this.maxPeak)
                this.maxPeak = v;
            this.cur.sq += v * v;
            this.cur.n++;
            this.sumSq += v * v;
            this.samples++;
            if (this.cur.n >= Math.floor(per + this.carry)) {
                this.carry = per + this.carry - this.cur.n;
                this.flushFrame();
            }
        }
    }
    finish() {
        if (this.cur.n)
            this.flushFrame();
        const issues = [];
        const loud = this.rms.map((r) => r >= SILENT);
        const first = loud.indexOf(true), last = loud.lastIndexOf(true);
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
                const clipped = i < this.peaks.length && this.peaks[i] >= CLIP;
                if (clipped)
                    clipFrom ??= i;
                else if (clipFrom !== null) {
                    if (i - clipFrom >= 2) {
                        issues.push({ level: "warning", kind: "clipping", frame: clipFrom, endFrame: i - 1,
                            message: `Sound clips (too loud, distorts) at ${timecode(clipFrom, this.fps)}–${timecode(i - 1, this.fps)}` });
                    }
                    clipFrom = null;
                }
            }
        }
        const db = (v) => (v > 0 ? Math.round(20 * Math.log10(v) * 10) / 10 : null);
        return {
            hasAudio: true, frames: this.peaks.length, fps: this.fps, peaks: this.peaks,
            rmsDb: this.samples ? db(Math.sqrt(this.sumSq / this.samples)) : null, peakDb: db(this.maxPeak), issues,
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
    const ff = (opts.ffmpeg ?? remotionFfmpeg)(["-v", "error", "-i", opts.file, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-flags", "+bitexact", "-map_metadata", "-1", "-f", "wav", "-"], opts.root);
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
            return resolve({ hasAudio: false, frames: 0, fps: opts.fps, peaks: [], rmsDb: null, peakDb: null,
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
