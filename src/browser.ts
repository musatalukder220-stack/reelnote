// Finds Chrome, Edge, Chromium or Brave and opens ReelNote in its own app window.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { configString } from "./project.js";

export const findBrowser = (root: string): string | null => {
  const pf = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const pf86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const lad = process.env.LOCALAPPDATA;
  const candidates = [
    process.env.REELNOTE_BROWSER,
    configString(root, "setBrowserExecutable"),
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    // Windows
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    lad && join(lad, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    // Linux
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/snap/bin/chromium", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/usr/bin/brave-browser",
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
};

export const launchWindow = (opts: {
  browser: string; url: string; devtoolsPort: number; profileDir: string; headless: boolean; size: string; position: string;
}): ChildProcess => {
  const args = [
    `--remote-debugging-port=${opts.devtoolsPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--lang=en-US",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    `--window-size=${opts.size}`,
  ];
  if (opts.headless) args.push("--headless=new", "--hide-scrollbars", "--mute-audio", opts.url);
  else args.push(`--window-position=${opts.position}`, `--app=${opts.url}`);
  if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
  return spawn(opts.browser, args, { stdio: "ignore", windowsHide: false });
};
