import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION: string = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
export const CLIENT_DIR = join(PKG_ROOT, "client");

export const IS_WIN = process.platform === "win32";

export const token = () => randomBytes(18).toString("hex");

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Windows runs npx through npx.cmd, which Node only starts through a shell, so arguments are quoted by hand.
const winQuote = (a: string) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
export const npx = (args: string[], opts: SpawnOptions): ChildProcess =>
  spawn(IS_WIN ? "npx.cmd" : "npx", IS_WIN ? args.map(winQuote) : args, { ...opts, shell: IS_WIN, windowsHide: true });

// Stop a process and everything it started (the Remotion CLI starts browsers and ffmpeg).
export const killTree = (proc: ChildProcess, signal: NodeJS.Signals = "SIGINT") => {
  if (!proc.pid) return;
  if (IS_WIN) {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      proc.kill(signal);
    } catch {
      /* already gone */
    }
  }
};

export const freePort = (preferred = 0): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });

export const timecode = (frame: number, fps: number) => {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

export const frameLabel = (frame: number, endFrame: number | null, fps: number) =>
  endFrame !== null && endFrame !== frame
    ? `frames ${frame}–${endFrame} (${timecode(frame, fps)}–${timecode(endFrame, fps)})`
    : `frame ${frame} (${timecode(frame, fps)})`;

export const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80);
