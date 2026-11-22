import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeProject } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

const mcp = (root) => {
  const p = spawn(process.execPath, [CLI, "mcp", "--project", root], { stdio: ["pipe", "pipe", "ignore"] });
  const rl = createInterface({ input: p.stdout });
  const waiting = new Map();
  let id = 0;
  rl.on("line", (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  const rpc = (method, params) => new Promise((res) => {
    const i = ++id;
    waiting.set(i, res);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
  return { rpc, tool: async (name, args) => (await rpc("tools/call", { name, arguments: args })).result, close: () => p.kill() };
};

test("MCP server works without the window for notes, and says how to open it", async () => {
  const root = fakeProject();
  mkdirSync(join(root, ".reelnote"), { recursive: true });
  writeFileSync(join(root, ".reelnote", "notes.json"), JSON.stringify({ version: 2, notes: [
    { id: 1, composition: "Intro", frame: 5, endFrame: null, fps: 30, kind: "visual", text: "logo too small", marks: [{ type: "rect", x: 0, y: 0, w: 10, h: 10 }], status: "open", replies: [] },
  ] }));
  const s = mcp(root);
  try {
    const init = await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    assert.equal(init.result.serverInfo.name, "reelnote");
    assert.match(init.result.instructions, /reelnote_notes/);
    const tools = (await s.rpc("tools/list", {})).result.tools.map((t) => t.name);
    assert.ok(tools.includes("reelnote_compare") && tools.includes("reelnote_audio") && tools.includes("reelnote_reply"));
    const list = await s.tool("reelnote_notes", {});
    assert.match(list.content[0].text, /logo too small/);
    assert.match(list.content[0].text, /box x 0–10/);
    const upd = await s.tool("reelnote_note_update", { id: 1, status: "fixed", reply: "Logo is 2× bigger" });
    assert.match(upd.content[0].text, /0 open/);
    const saved = JSON.parse(readFileSync(join(root, ".reelnote", "notes.json"), "utf8")).notes[0];
    assert.equal(saved.status, "fixed");
    assert.equal(saved.replies[0].by, "claude");
    const frame = await s.tool("reelnote_frame", { composition: "Intro", frame: 1 });
    assert.equal(frame.isError, true);
    assert.match(frame.content[0].text, /npx reelnote/);
    const missing = await s.tool("reelnote_note", { id: 99 });
    assert.equal(missing.isError, true);
    const unknown = await s.rpc("nope/nope", {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    s.close();
  }
});

test("init connects Claude Code and keeps existing settings", () => {
  const root = fakeProject();
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, model: "opus" }));
  execFileSync(process.execPath, [CLI, "init"], { cwd: root, stdio: "ignore" });
  const m = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.ok(m.mcpServers.other && m.mcpServers.reelnote);
  assert.deepEqual(m.mcpServers.reelnote.args.slice(1, 2), ["mcp"]);
  const st = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(st.permissions.allow, ["Bash(ls)", "mcp__reelnote"]);
  assert.deepEqual(st.enabledMcpjsonServers, ["reelnote"]);
  assert.equal(st.model, "opus");
  execFileSync(process.execPath, [CLI, "init"], { cwd: root, stdio: "ignore" });
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")).permissions.allow, ["Bash(ls)", "mcp__reelnote"], "running twice adds nothing");
});
