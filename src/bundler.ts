// The project's own esbuild bundles the ReelNote app together with the film's code, and rebuilds when code changes.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectRequire, resolveFromProject } from "./project.js";
import { CLIENT_DIR } from "./util.js";

type Esbuild = {
  context(o: Record<string, unknown>): Promise<{ watch(): Promise<void>; rebuild(): Promise<unknown>; dispose(): Promise<void> }>;
  formatMessagesSync(m: Message[], o: { kind: "error" | "warning"; color: boolean }): string[];
};
type Message = { text: string; location?: { file: string; line: number; column: number; lineText: string } | null };

export const findEsbuild = (root: string): string | null => {
  const direct = resolveFromProject(root, "esbuild");
  if (direct) return direct;
  const bundler = resolveFromProject(root, "@remotion/bundler/package.json");
  if (!bundler) return null;
  try {
    return projectRequire(dirname(bundler)).resolve("esbuild");
  } catch {
    return null;
  }
};

// .env next to the project, the way Remotion reads it (simple KEY=value lines), plus REMOTION_* from the shell
export const readEnv = (root: string): Record<string, string> => {
  const env: Record<string, string> = {};
  const file = join(root, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("REMOTION_") && v !== undefined) env[k] = v;
  return env;
};

const ASSETS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac",
  ".mp4", ".webm", ".mov", ".mkv", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".glb", ".gltf", ".bin", ".hdr", ".lottie", ".riv", ".wasm"];

export const createBundler = async (opts: {
  root: string; entry: string; outdir: string;
  onError: (text: string) => void; onReady: (first: boolean) => void;
}) => {
  const esbuildPath = findEsbuild(opts.root);
  if (!esbuildPath) throw new Error("esbuild not found. Run `npm install` in your Remotion project first.");
  const esbuild = projectRequire(opts.root)(esbuildPath) as Esbuild;
  const env = { NODE_ENV: "production", ...readEnv(opts.root) };
  let first = true;

  const plugin = {
    name: "reelnote",
    setup(build: PluginBuild) {
      // the film's entry point (it calls registerRoot)
      build.onResolve({ filter: /^reelnote:entry$/ }, () => ({ path: opts.entry }));
      // every `import … from "remotion"` goes through ReelNote's shim, which records <Composition>s
      build.onResolve({ filter: /^remotion$/ }, (a) => (a.pluginData?.real ? undefined : { path: join(CLIENT_DIR, "shim.tsx") }));
      build.onResolve({ filter: /^reelnote:remotion$/ }, () => build.resolve("remotion", { kind: "import-statement", resolveDir: opts.root, pluginData: { real: true } }));
      // bare imports from ReelNote's own files resolve from the project, so React and Remotion exist exactly once
      build.onResolve({ filter: /^[^./]/ }, (a) => {
        if (a.pluginData?.fromRoot || !a.importer.startsWith(CLIENT_DIR) || a.path.startsWith("reelnote:")) return undefined;
        return build.resolve(a.path, { kind: a.kind, resolveDir: opts.root, pluginData: { fromRoot: true } });
      });
      build.onEnd((result) => {
        if (result.errors.length) {
          opts.onError(esbuild.formatMessagesSync(result.errors, { kind: "error", color: false }).join("\n"));
        } else {
          opts.onReady(first);
          first = false;
        }
      });
    },
  };

  const ctx = await esbuild.context({
    entryPoints: { main: join(CLIENT_DIR, "main.tsx") },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outdir: opts.outdir,
    publicPath: "/__rn/build/",
    jsx: "automatic",
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: `globalThis.process ??= { env: ${JSON.stringify(env)} }; globalThis.process.env ??= ${JSON.stringify(env)};` },
    loader: Object.fromEntries([...ASSETS.map((e) => [e, "file"]), [".txt", "text"], [".md", "text"], [".srt", "text"], [".vtt", "text"], [".csv", "text"]]),
    assetNames: "assets/[name]-[hash]",
    absWorkingDir: opts.root,
    nodePaths: [join(opts.root, "node_modules")],
    logLevel: "silent",
    plugins: [plugin],
  });
  return { ctx, esbuild };
};

// Just the bits of esbuild's plugin API used above (esbuild's types come from the user's project at runtime).
type ResolveArgs = { path: string; importer: string; kind: string; resolveDir: string; pluginData?: Record<string, unknown> };
type PluginBuild = {
  onResolve(o: { filter: RegExp }, cb: (a: ResolveArgs) => unknown): void;
  onEnd(cb: (r: { errors: Message[] }) => void): void;
  resolve(path: string, o: { kind: string; resolveDir: string; pluginData?: Record<string, unknown> }): Promise<unknown>;
};
