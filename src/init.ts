// `reelnote init`: connects ReelNote to Claude Code in this project (.mcp.json + .claude/settings.json).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findEntry, findProject, resolveFromProject } from "./project.js";
import { PKG_ROOT } from "./util.js";

const readJson = (f: string): Record<string, any> => {
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    throw new Error(`${f} isn't valid JSON. Fix it and run init again.`);
  }
};

export const runInit = (projectArg?: string) => {
  const project = findProject(projectArg ?? process.cwd());
  if (!project) throw new Error("No Remotion project here (no package.json that depends on remotion).");
  const root = project.root;
  const cli = join(PKG_ROOT, "dist", "cli.js");
  // absolute paths: Claude Code may start MCP servers from another folder. Moving the project? Run init again.
  const local = !relative(root, PKG_ROOT).startsWith("..") && relative(root, PKG_ROOT).split(sep)[0] === "node_modules";
  const server = { command: "node", args: [cli, "mcp", "--project", root] };

  const mcpFile = join(root, ".mcp.json");
  const mcp = readJson(mcpFile);
  mcp.mcpServers = { ...(mcp.mcpServers ?? {}), reelnote: server };
  writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");

  mkdirSync(join(root, ".claude"), { recursive: true });
  const setFile = join(root, ".claude", "settings.json");
  const set = readJson(setFile);
  set.enabledMcpjsonServers = Array.from(new Set([...(set.enabledMcpjsonServers ?? []), "reelnote"]));
  set.permissions = set.permissions ?? {};
  set.permissions.allow = Array.from(new Set([...(set.permissions.allow ?? []), "mcp__reelnote"]));
  writeFileSync(setFile, JSON.stringify(set, null, 2) + "\n");

  const notes: string[] = [];
  if (!resolveFromProject(root, "@remotion/player/package.json")) notes.push("Install the player once:  npx remotion add @remotion/player");
  if (!existsSync(join(root, "node_modules"))) notes.push("Install the project's packages:  npm install");
  if (!findEntry(root)) notes.push("Couldn't find your entry file (src/index.ts). Start ReelNote with --entry <file>.");
  const start = local ? "npx reelnote" : `node ${cli}`;
  console.log(`ReelNote is connected to Claude Code in ${project.name}.
  wrote  .mcp.json (server "reelnote")
  wrote  .claude/settings.json (tools allowed without prompts)
${notes.map((n) => `  ! ${n}`).join("\n")}${notes.length ? "\n" : ""}
Next:
  1. Start the review window:   ${start}
  2. Restart Claude Code once so it loads the reelnote_* tools.
  3. Press N on any frame, mark what's wrong, write a note. Then tell Claude: "fix my ReelNote notes".`);
};
