// `reelnote init`: connects ReelNote to Claude Code in this project (.mcp.json + .claude/settings.json).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findEntry, findProject, resolveFromProject } from "./project.js";
import { PKG_ROOT, VERSION } from "./util.js";

export const REPO = "github:musatalukder220-stack/reelnote";

// Run through `npx github:…`, ReelNote lives in npm's temporary cache, which can be cleared at any time.
// So init keeps a copy inside the project (.reelnote/app, ignored by git) for Claude Code to start.
export const isTemporaryCopy = (dir = PKG_ROOT) => /[\\/]_npx[\\/]/.test(dir);

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
  let cli = join(PKG_ROOT, "dist", "cli.js");
  if (isTemporaryCopy()) {
    const app = join(root, ".reelnote", "app");
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app, { recursive: true });
    for (const part of ["dist", "client", "package.json", "LICENSE"]) {
      if (existsSync(join(PKG_ROOT, part))) cpSync(join(PKG_ROOT, part), join(app, part), { recursive: true });
    }
    if (!existsSync(join(root, ".reelnote", ".gitignore"))) writeFileSync(join(root, ".reelnote", ".gitignore"), "*\n");
    cli = join(app, "dist", "cli.js");
  }
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
  const start = local ? "npx reelnote" : isTemporaryCopy() ? `npx ${REPO}   (or, offline: node ${relative(root, cli)})` : `node ${cli}`;
  console.log(`ReelNote ${VERSION} is connected to Claude Code in ${project.name}.
  wrote  .mcp.json (server "reelnote")
  wrote  .claude/settings.json (tools allowed without prompts)
${notes.map((n) => `  ! ${n}`).join("\n")}${notes.length ? "\n" : ""}
Next:
  1. Start the review window:   ${start}
  2. Restart Claude Code once so it loads the reelnote_* tools.
  3. Press N on any frame, mark what's wrong, write a note. Then tell Claude: "fix my ReelNote notes".`);
};
