// How much memory the computer has left. macOS: vm_stat + sysctl (with swap and the kernel's own pressure level).
// Linux: /proc/meminfo and pressure stall info. Windows: what the OS reports. Shown while rendering; the queue waits when critical.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
const GB = 1073741824, MB = 1048576;
const byShare = (share) => (share < 0.05 ? "critical" : share < 0.1 ? "warning" : "normal");
const worst = (a, b) => {
    const rank = { normal: 0, warning: 1, critical: 2 };
    return rank[a] >= rank[b] ? a : b;
};
export const parseMeminfo = (text, psi) => {
    const kb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
    const total = kb("MemTotal");
    const available = kb("MemAvailable") || kb("MemFree") + kb("Cached");
    const swapUsed = kb("SwapTotal") - kb("SwapFree");
    let pressure = byShare(total ? available / total : 1);
    const avg10 = Number(psi?.match(/^some avg10=([\d.]+)/m)?.[1] ?? NaN);
    if (!Number.isNaN(avg10))
        pressure = worst(pressure, avg10 >= 50 ? "critical" : avg10 >= 20 ? "warning" : "normal");
    return { platform: "linux", totalGB: total / GB, availableMB: Math.round(available / MB), usedGB: (total - available) / GB, swapUsedGB: swapUsed / GB, pressure };
};
export const parseVmStat = (vm, totalBytes, swapText, level) => {
    const pageSize = Number(vm.match(/page size of (\d+)/)?.[1] ?? 16384);
    const pages = (label) => Number(vm.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
    // like Activity Monitor: memory that can be handed to apps without swapping
    const available = (pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable")) * pageSize;
    const used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;
    const swapUsedMB = Number(swapText.match(/used = ([\d.]+)M/)?.[1] ?? 0);
    // the kernel's own verdict: 1 normal, 2 warning, 4 critical
    const pressure = level >= 4 ? "critical" : level >= 2 ? "warning" : "normal";
    return { platform: "darwin", totalGB: totalBytes / GB, availableMB: Math.round(available / MB), usedGB: Math.max(0, used) / GB, swapUsedGB: swapUsedMB / 1024, pressure };
};
export const readMemory = () => {
    try {
        if (process.platform === "darwin") {
            const sys = (k) => execFileSync("sysctl", ["-n", k], { encoding: "utf8" }).trim();
            let level = 1;
            try {
                level = Number(sys("kern.memorystatus_vm_pressure_level"));
            }
            catch {
                /* older macOS */
            }
            return parseVmStat(execFileSync("vm_stat", { encoding: "utf8" }), Number(sys("hw.memsize")), sys("vm.swapusage"), level);
        }
        if (process.platform === "linux") {
            let psi = null;
            try {
                psi = readFileSync("/proc/pressure/memory", "utf8");
            }
            catch {
                /* kernel without PSI */
            }
            return parseMeminfo(readFileSync("/proc/meminfo", "utf8"), psi);
        }
    }
    catch {
        /* fall through to what Node reports */
    }
    const total = os.totalmem(), free = os.freemem();
    return { platform: process.platform, totalGB: total / GB, availableMB: Math.round(free / MB), usedGB: (total - free) / GB, swapUsedGB: null, pressure: byShare(free / total) };
};
// How many frames Remotion may render at once. Small machines get one thread: two threads on an 8 GB laptop
// is where dropped and black frames usually come from. More memory and cores allow more, never above 8.
export const autoConcurrency = (mem, cpus = os.cpus().length) => {
    if (!mem)
        return 1;
    if (mem.pressure !== "normal")
        return 1;
    const byRam = mem.totalGB <= 8.5 ? 1 : mem.totalGB <= 16.5 ? 2 : mem.totalGB <= 32.5 ? 4 : 6;
    const byFree = Math.max(1, Math.floor(mem.availableMB / 1500));
    return Math.max(1, Math.min(byRam, byFree, Math.max(1, Math.floor(cpus / 2)), 8));
};
