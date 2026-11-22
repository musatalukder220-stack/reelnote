// The project's own esbuild bundles the ReelNote app together with the film's code, and rebuilds when code changes.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
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

// ---------- CSS through the project's own PostCSS / Tailwind (v3 or v4), when it has one ----------
type CssProcessor = (css: string, from: string) => Promise<{ css: string; deps: string[] }>;

const loadModule = async (root: string, spec: string, from?: string): Promise<any> => {
  const resolved = resolveFromProject(root, spec) ?? (from ? (() => {
    try {
      return projectRequire(from).resolve(spec);
    } catch {
      return null;
    }
  })() : null);
  if (!resolved) return null;
  const m = await import(pathToFileURL(resolved).href);
  return m.default ?? m;
};

export const findCssProcessor = async (root: string): Promise<{ kind: string; run: CssProcessor } | null> => {
  const cfgFile = ["postcss.config.mjs", "postcss.config.js", "postcss.config.cjs", ".postcssrc.json"].map((f) => join(root, f)).find((f) => existsSync(f));
  let plugins: unknown[] = [];
  let kind = "";
  let pluginDir: string | undefined;
  if (cfgFile) {
    const cfg = cfgFile.endsWith(".json") ? JSON.parse(readFileSync(cfgFile, "utf8")) : await import(pathToFileURL(cfgFile).href).then((m) => m.default ?? m);
    const list = typeof cfg === "function" ? (await cfg({ env: "development" })).plugins : cfg.plugins;
    if (Array.isArray(list)) plugins = list.filter(Boolean);
    else if (list && typeof list === "object") {
      for (const [name, opts] of Object.entries(list as Record<string, unknown>)) {
        if (opts === false) continue;
        const mod = await loadModule(root, name);
        if (!mod) throw new Error(`PostCSS plugin "${name}" from ${cfgFile} isn't installed.`);
        plugins.push(typeof mod === "function" ? mod(opts && typeof opts === "object" ? opts : undefined) : mod);
      }
    }
    kind = `PostCSS (${cfgFile.split(sep).pop()})`;
  } else {
    // Remotion's Tailwind packages bring these along; look next to them too
    const v4dir = resolveFromProject(root, "@remotion/tailwind-v4/package.json");
    const tw4 = await loadModule(root, "@tailwindcss/postcss", v4dir ? dirname(v4dir) : undefined);
    if (tw4) {
      plugins = [tw4({ base: root })];
      kind = "Tailwind 4";
      pluginDir = dirname(resolveFromProject(root, "@tailwindcss/postcss/package.json") ?? (v4dir ? projectRequire(dirname(v4dir)).resolve("@tailwindcss/postcss/package.json") : root));
    } else {
      const twCfg = ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts"].map((f) => join(root, f)).find((f) => existsSync(f));
      const v3dir = resolveFromProject(root, "@remotion/tailwind/package.json");
      const tw3 = twCfg ? await loadModule(root, "tailwindcss", v3dir ? dirname(v3dir) : undefined) : null;
      if (tw3 && typeof tw3 === "function") {
        plugins = [tw3(twCfg)];
        const ap = await loadModule(root, "autoprefixer", v3dir ? dirname(v3dir) : undefined);
        if (ap) plugins.push(ap());
        kind = "Tailwind 3";
        pluginDir = v3dir ? dirname(v3dir) : undefined;
      }
    }
  }
  if (!plugins.length) return null;
  const postcss = await loadModule(root, "postcss", pluginDir);
  if (!postcss) throw new Error("Found a PostCSS/Tailwind setup but not the postcss package. Run npm install.");
  const processor = postcss(plugins);
  return {
    kind,
    run: async (css, from) => {
      const r = await processor.process(css, { from, to: from });
      const deps = r.messages.filter((m: { type: string; file?: string }) => m.type === "dependency" && m.file).map((m: { file: string }) => m.file);
      return { css: r.css, deps };
    },
  };
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
  let css: Awaited<ReturnType<typeof findCssProcessor>> = null;
  try {
    css = await findCssProcessor(opts.root);
    if (css) console.log(`ReelNote: styles go through ${css.kind}`);
  } catch (e) {
    console.warn(`ReelNote: ${(e as Error).message} Styles load without it.`);
  }

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
      // the project's CSS through its PostCSS / Tailwind (ReelNote's own CSS and packages' CSS as they are)
      if (css) {
        const run = css.run;
        build.onLoad({ filter: /\.css$/ }, async (a) => {
          if (a.path.startsWith(CLIENT_DIR) || a.path.includes(`${sep}node_modules${sep}`)) return undefined;
          try {
            const r = await run(readFileSync(a.path, "utf8"), a.path);
            return { contents: r.css, loader: "css", resolveDir: dirname(a.path), watchFiles: r.deps };
          } catch (e) {
            return { errors: [{ text: (e as Error).message }] };
          }
        });
      }
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
  onLoad(o: { filter: RegExp }, cb: (a: { path: string }) => unknown): void;
  onEnd(cb: (r: { errors: Message[] }) => void): void;
  resolve(path: string, o: { kind: string; resolveDir: string; pluginData?: Record<string, unknown> }): Promise<unknown>;
};
