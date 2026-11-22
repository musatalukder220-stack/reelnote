// End-to-end check against a real Remotion project (default: examples/demo-film, after `npm install` there).
//   node test/e2e.mjs [--project <folder>] [--keep]
// Starts ReelNote with an invisible window, writes a note with marks, uses every MCP tool,
// renders Tests/Glitchy and checks the frame check finds its black frame and stutter, builds Intro's sound.
import { spawn } from "node:child_process";
import http from "node:http";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");
const args = process.argv.slice(2);
const ROOT = resolve(args.includes("--project") ? args[args.indexOf("--project") + 1] : join(HERE, "..", "examples", "demo-film"));
const PORT = 4610;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${what}`);
  if (!cond) failures++;
};
if (!existsSync(join(ROOT, "node_modules", "remotion"))) {
  console.error(`Run npm install in ${ROOT} first.`);
  process.exit(2);
}
if (!args.includes("--keep")) rmSync(join(ROOT, ".reelnote"), { recursive: true, force: true });

console.log(`ReelNote e2e · ${ROOT}`);
const app = spawn(process.execPath, [CLI, "--project", ROOT, "--headless", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));
const stop = () => app.kill("SIGTERM");
process.on("exit", stop);

const server = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const s = JSON.parse(readFileSync(join(ROOT, ".reelnote", "server.json"), "utf8"));
      if ((await fetch(`http://localhost:${s.port}/__rn/ping`)).ok) return s;
    } catch {}
    await sleep(200);
  }
  throw new Error(`app didn't start:\n${appLog}`);
};
const s = await server();
const api = async (path, body, method) => {
  const r = await fetch(`http://localhost:${s.port}/__rn/api/${path}`, {
    method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", "x-reelnote-token": s.token }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${path}: ${data.error}`);
  return data;
};

console.log("app");
ok((await fetch(`http://localhost:${s.port}/__rn/api/state`)).status === 401, "API refuses calls without the token");
const hostStatus = await new Promise((res) => http.get({ host: "127.0.0.1", port: s.port, path: "/", headers: { Host: "evil.example" } }, (x) => { x.resume(); res(x.statusCode); }).on("error", () => res(0)));
ok(hostStatus === 403, "refuses other host names (DNS rebinding)");
let comps = [];
for (let i = 0; i < 300 && !comps.length; i++) {
  comps = await api("compositions");
  if (!comps.length) await sleep(200);
}
if (!comps.length) console.log(appLog);
ok(comps.length > 0, `window found ${comps.length} compositions: ${comps.map((c) => c.id).join(", ")}`);
const first = comps.find((c) => !c.still) ?? comps[0];
const mid = Math.floor(first.durationInFrames / 2);

const note = await api("notes", { composition: first.id, frame: mid, text: "e2e: this should be bigger", marks: [
  { type: "ellipse", cx: first.width / 2, cy: first.height / 2, rx: first.width / 8, ry: first.height / 8 },
  { type: "arrow", x1: 10, y1: 10, x2: first.width / 3, y2: first.height / 3 },
] });
ok(existsSync(join(ROOT, ".reelnote", note.image)) && existsSync(join(ROOT, ".reelnote", note.clean)), `note #${note.id} saved with two pictures`);
const sound = await api("notes", { composition: first.id, frame: 0, endFrame: 20, kind: "audio", text: "e2e: music too loud" });
ok(sound.kind === "audio" && sound.endFrame === 20 && sound.marks.length === 0, "sound note over a range");
ok(sound.strip && existsSync(join(ROOT, ".reelnote", sound.strip)), "a range note gets a filmstrip");

console.log("props");
await api("props", { composition: first.id, props: { e2eProp: "x" } }, "PUT");
ok((await api("props"))[first.id]?.e2eProp === "x", "props are saved");
const withProps = await api("notes", { composition: first.id, frame: 1, text: "e2e: with props" });
ok(withProps.props?.e2eProp === "x", "a note remembers the props it was seen with");
await api("props", { composition: first.id, props: {} }, "PUT");
ok(!(first.id in (await api("props"))), "props reset");

console.log("mcp");
const mcp = spawn(process.execPath, [CLI, "mcp", "--project", ROOT], { stdio: ["pipe", "pipe", "ignore"] });
const rl = createInterface({ input: mcp.stdout });
const waiting = new Map();
let rid = 0;
rl.on("line", (l) => {
  const m = JSON.parse(l);
  waiting.get(m.id)?.(m);
});
const rpc = (method, params) => new Promise((res) => {
  const i = ++rid;
  waiting.set(i, res);
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
});
const tool = async (name, a = {}) => (await rpc("tools/call", { name, arguments: a })).result;
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
const txt = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const imgs = (r) => r.content.filter((c) => c.type === "image").length;
let r = await tool("reelnote_notes");
ok(txt(r).includes("e2e: this should be bigger") && txt(r).includes("arrow pointing"), "reelnote_notes lists the note and its marks");
r = await tool("reelnote_note", { id: note.id });
ok(imgs(r) === 1, "reelnote_note returns the marked picture");
r = await tool("reelnote_frame", { composition: first.id, frame: 1 });
ok(!r.isError && imgs(r) === 1, "reelnote_frame returns a live picture");
r = await tool("reelnote_compare", { id: note.id });
ok(!r.isError && imgs(r) === 2, "reelnote_compare returns before and now");
r = await tool("reelnote_frame", { composition: "does-not-exist", frame: 1 });
ok(r.isError && /No composition called/.test(txt(r)), "unknown composition is a clear error");
r = await tool("reelnote_strip", { composition: first.id, from: 0, to: Math.min(30, first.durationInFrames - 1), count: 6 });
ok(!r.isError && imgs(r) === 1 && /frames 0, /.test(txt(r)), "reelnote_strip returns a filmstrip");
r = await tool("reelnote_note", { id: sound.id });
ok(imgs(r) === 2, "reelnote_note shows the filmstrip of a range note");
r = await tool("reelnote_reply", { id: note.id, text: "Bigger how much?" });
// a code change while working on the note is recorded, shown and can be undone
const entryFile = join(ROOT, "src", existsSync(join(ROOT, "src", "Root.tsx")) ? "Root.tsx" : "index.ts");
const original = readFileSync(entryFile, "utf8");
appendFileSync(entryFile, "\n// e2e change\n");
r = await tool("reelnote_note_update", { id: note.id, status: "fixed", reply: "Doubled it" });
ok(/is fixed/.test(txt(r)) && txt(r).includes("Recorded changes: src/"), `reelnote_note_update records the change (${txt(r)})`);
r = await tool("reelnote_changes", { id: note.id });
ok(txt(r).includes("+// e2e change"), "reelnote_changes shows the diff");
const ch = await api(`notes/${note.id}/changes`);
ok(ch.files.length === 1 && ch.files[0].added >= 1, "the window can show the change");
await api(`notes/${note.id}/undo`, {});
ok(readFileSync(entryFile, "utf8") === original, "undo puts the file back exactly");
const undone = (await api("notes")).find((n) => n.id === note.id);
ok(undone.status === "open" && undone.fix.undone, "undo reopens the note");
writeFileSync(entryFile, original);
r = await tool("reelnote_note_update", { id: note.id, status: "fixed", reply: "Doubled it" });
r = await tool("reelnote_compositions");
ok(txt(r).includes(first.id), "reelnote_compositions");

const hasGlitchy = comps.some((c) => c.id === "Glitchy");
const target = hasGlitchy ? "Glitchy" : first.id;
console.log(`render ${target}`);
r = await tool("reelnote_render", { composition: target });
ok(/Render started|Queued/.test(txt(r)), "reelnote_render starts");
const until = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await api("render");
    if (cond(st)) return st;
    await sleep(1000);
  }
  return null;
};
let st = await until((x) => x.history.some((h) => h.composition === target && h.kind === "video"), 300000);
const done = st?.history.find((h) => h.composition === target && h.kind === "video");
ok(done?.status === "done", `render finished: ${done?.status} ${done?.error ?? ""}`);
if (hasGlitchy && done?.video) {
  const kinds = done.video.issues.map((i) => `${i.kind}@${i.frame}`);
  ok(kinds.includes("black-flash@40"), `frame check finds the black frame (${kinds.join(", ")})`);
  ok(kinds.includes("stutter@60"), "frame check finds the stutter");
}
r = await tool("reelnote_render_status");
ok(/Done/.test(txt(r)), "reelnote_render_status reports the result");
// render again: the first render is kept and the two are compared
await api("render", { composition: target });
st = await until((x) => x.history.filter((h) => h.composition === target && h.kind === "video").length >= 2, 300000);
r = await tool("reelnote_render_diff", { composition: target });
ok(/No frames changed/.test(txt(r)), `reelnote_render_diff compares two renders (${txt(r).split("\n").pop()})`);

if (comps.some((c) => c.id === "Intro")) {
  console.log("sound");
  await tool("reelnote_audio", { composition: "Intro" });
  st = await until((x) => x.history.some((h) => h.composition === "Intro" && h.kind === "waveform"), 180000);
  r = await tool("reelnote_audio", { composition: "Intro" });
  ok(/Silence for 1\.0 s/.test(txt(r)), "reelnote_audio finds the silent gap");
  ok(/LUFS/.test(txt(r)), "reelnote_audio gives loudness in LUFS");
  const w = await api("waveform?composition=Intro");
  ok(w.peaks.length === 150, "waveform has one value per frame");
}

console.log("share");
const sh = await api("share", { on: true });
ok(sh.on && sh.port, `sharing starts (${sh.urls[0] ?? "no network address here"})`);
const shareKey = sh.urls[0] ? new URL(sh.urls[0]).searchParams.get("k") : null;
if (sh.urls[0]) {
  const base = new URL(sh.urls[0]).origin;
  ok((await fetch(`${base}/`)).status === 401, "the share link needs its key");
  const page = await fetch(sh.urls[0]);
  ok(page.status === 200 && /rn_k=/.test(page.headers.get("set-cookie") ?? "") && (await page.text()).includes('"role":"reviewer"'), "the key opens the reviewer page");
  const rapi = async (path, body, method) => fetch(`${base}/__rn/api/${path}`, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", "x-reelnote-token": shareKey }, body: body ? JSON.stringify(body) : undefined });
  ok((await rapi("notes")).status === 200, "a reviewer can read notes");
  ok((await rapi("render", { composition: target })).status === 403, "a reviewer can't render");
  ok((await rapi("cleanup", {})).status === 403, "a reviewer can't clean up");
  ok((await rapi(`notes/${note.id}`, undefined, "DELETE")).status === 403, "a reviewer can't delete notes");
  const rn = await (await rapi("notes", { composition: first.id, frame: 2, text: "e2e: from a phone", author: "Rahim" })).json();
  ok(rn.author === "Rahim", "a reviewer's note carries their name");
  ok((await fetch(`${base}/__rn/api/state`, { headers: { "x-reelnote-token": s.token } })).status === 401, "the owner's token doesn't work on the share link");
  r = await tool("reelnote_notes");
  ok(txt(r).includes("from reviewer Rahim"), "Claude sees who wrote it");
}
const off = await api("share", { on: false });
ok(!off.on, "sharing stops");
if (sh.urls[0]) ok(await fetch(sh.urls[0]).then(() => false, () => true), "the link stops working");

console.log("report");
for (const format of ["md", "html", "pdf"]) {
  r = await tool("reelnote_report", { format, lang: "bn" });
  const file = txt(r).replace("Report written: ", "").trim();
  ok(existsSync(file), `${format} report written`);
}
const del = await api(`notes/${sound.id}`, undefined, "DELETE");
ok(del.ok && !(await api("notes")).some((n) => n.id === sound.id), "note deleted");

mcp.kill();
stop();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
