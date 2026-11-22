// Leftovers worth deleting: Remotion's temporary bundles and render folders (left behind when a render is stopped
// or crashes), the frame pictures made for Claude's checks and the audio files behind waveforms.
// Never touches your renders, your notes or your project.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export type Leftover = { kind: "remotion" | "frames" | "audio"; path: string; bytes: number };

const sizeOf = (p: string): number => {
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    let s = 0;
    for (const e of readdirSync(p)) s += sizeOf(join(p, e));
    return s;
  } catch {
    return 0;
  }
};

export const REMOTION_TMP = /^(remotion-webpack-bundle-|remotion-v[\d.]+-assets|react-motion-render|remotion-assets-dir)/;

export const findLeftovers = (dataDir: string, tmp = os.tmpdir()): Leftover[] => {
  const items: Leftover[] = [];
  try {
    for (const n of readdirSync(tmp)) if (REMOTION_TMP.test(n)) items.push({ kind: "remotion", path: join(tmp, n), bytes: sizeOf(join(tmp, n)) });
  } catch {
    /* no access to the temp folder */
  }
  const frames = join(dataDir, "frames");
  if (existsSync(frames)) for (const f of readdirSync(frames)) items.push({ kind: "frames", path: join(frames, f), bytes: sizeOf(join(frames, f)) });
  const audio = join(dataDir, "audio");
  if (existsSync(audio)) for (const f of readdirSync(audio)) if (f.endsWith(".wav")) items.push({ kind: "audio", path: join(audio, f), bytes: sizeOf(join(audio, f)) });
  return items.filter((i) => i.bytes > 0);
};

// Remotion's temp folders belong to a running render or Studio: never delete them while one runs anywhere.
export const remotionRunning = (): boolean => {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine"], { encoding: "utf8", windowsHide: true });
      return out.split(/\r?\n/).some((l) => /(@remotion[\\/]cli|@remotion[\\/]compositor-|remotion(\.cmd)?\s+(render|studio))/i.test(l) && !/reelnote/i.test(l));
    }
    const out = execFileSync("ps", ["-axo", "command"], { encoding: "utf8" });
    return out.split("\n").some((l) => /(node_modules\/\.bin\/remotion|@remotion\/cli\/|@remotion\/compositor-)/.test(l) && !/reelnote/i.test(l));
  } catch {
    return false;
  }
};

export const removeLeftovers = (items: Leftover[]) => {
  let freed = 0;
  for (const it of items) {
    try {
      rmSync(it.path, { recursive: true, force: true });
      freed += it.bytes;
    } catch {
      /* in use or already gone */
    }
  }
  return freed;
};
