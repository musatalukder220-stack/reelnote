#!/usr/bin/env node
// ReelNote command line:
//   reelnote [options]        open the review window for the Remotion project in this folder
//   reelnote init             connect ReelNote to Claude Code in this project
//   reelnote mcp              the MCP server Claude Code starts (you don't run this yourself)
//   reelnote check <video>    check any video file for broken frames, stutters and sound problems
//   reelnote report           write the notes as md / html / pdf
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { VERSION } from "./util.js";
const HELP = `ReelNote ${VERSION} · review a Remotion video from code, frame by frame

Usage
  npx reelnote                 open the review window (run inside your Remotion project)
  npx reelnote init            connect it to Claude Code in this project
  npx reelnote check <video>   check a video file for broken frames, stutters and sound problems
  npx reelnote report          write the notes as a report (--format md|html|pdf, --lang en|bn)

Options for the window
  --project <folder>      the Remotion project (default: this folder)
  --entry <file>          your entry file, if not src/index.ts
  --port <n>              local port (default 4545; the next free one is used if busy)
  --no-window             don't open a window (frame pictures need it)
  --headless              open the window invisibly (servers, CI, remote machines)
  --window <w,h>          window size (default 1600,1000)

Keys in the window: Space play · ←/→ frame · Shift+←/→ 10 frames · N mark & note · A sound note · I/O range · ? all keys
`;
const args = process.argv.slice(2);
const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const cmd = args[0] && !args[0].startsWith("-") ? args[0] : "start";
const main = async () => {
    if (flag("version") || cmd === "version")
        return console.log(VERSION);
    if (flag("help") || flag("h") || cmd === "help")
        return console.log(HELP);
    switch (cmd) {
        case "start": {
            const { startApp } = await import("./app.js");
            const port = opt("port");
            await startApp({
                project: opt("project"), entry: opt("entry"), port: port ? Number(port) : undefined, portExplicit: !!port,
                window: !flag("no-window"), headless: flag("headless"), size: opt("window") ?? "1600,1000", position: opt("window-position") ?? "40,40",
            });
            return;
        }
        case "mcp": {
            const { startMcp } = await import("./mcp.js");
            return startMcp(opt("project"));
        }
        case "init": {
            const { runInit } = await import("./init.js");
            return runInit(opt("project"));
        }
        case "check": {
            const file = args[1] && !args[1].startsWith("--") ? resolve(args[1]) : null;
            if (!file || !existsSync(file))
                throw new Error("Usage: reelnote check <video file> [--fps 30]");
            const { checkVideo, analyzeAudio, probeFps, remotionFfmpeg, systemFfmpeg } = await import("./analyze.js");
            const { findProject, resolveFromProject } = await import("./project.js");
            const project = findProject(process.cwd());
            // Remotion's own ffmpeg when inside a Remotion project, otherwise the one on PATH
            const ffmpeg = project && resolveFromProject(project.root, "@remotion/cli/package.json") ? remotionFfmpeg : systemFfmpeg;
            const root = project?.root ?? process.cwd();
            const fps = Number(opt("fps") ?? (await probeFps({ root, file, ffmpeg })) ?? 30);
            console.log(`Checking ${file} …`);
            const v = await checkVideo({ root, file, fps, expected: null, ffmpeg, onProgress: (n) => process.stdout.isTTY && process.stdout.write(`\r  ${n} frames`) });
            if (process.stdout.isTTY)
                process.stdout.write(`\r${" ".repeat(24)}\r`);
            const a = await analyzeAudio({ root, file, fps, ffmpeg });
            const all = [...v.issues, ...a.issues].sort((x, y) => x.frame - y.frame);
            console.log(`${v.frames} frames at ${fps} fps · sound ${a.hasAudio ? `avg ${a.rmsDb} dB, peak ${a.peakDb} dB` : "none"}`);
            if (!all.length)
                console.log("No problems found.");
            for (const i of all)
                console.log(`  ${i.level === "error" ? "✗" : i.level === "warning" ? "!" : "·"} ${i.message}`);
            process.exitCode = all.some((i) => i.level === "error") ? 1 : 0;
            return;
        }
        case "report": {
            const { findProject } = await import("./project.js");
            const { loadNotes, dataDir } = await import("./notes.js");
            const { writeReport } = await import("./report.js");
            const { findBrowser } = await import("./browser.js");
            const project = findProject(opt("project") ?? process.cwd());
            if (!project)
                throw new Error("No Remotion project here.");
            const format = (opt("format") ?? "md");
            const file = await writeReport({ project: project.name, notes: loadNotes(project.root), dataDir: dataDir(project.root), format, lang: opt("lang") === "bn" ? "bn" : "en", browser: findBrowser(project.root) });
            console.log(`Report written: ${file}`);
            return;
        }
        default:
            console.log(HELP);
            process.exitCode = 1;
    }
};
main().catch((e) => {
    console.error(`ReelNote: ${e.message}`);
    process.exit(1);
});
