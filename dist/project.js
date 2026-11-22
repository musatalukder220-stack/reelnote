// Finds the Remotion project ReelNote runs in, and the packages it already has.
// ReelNote installs nothing into your project: esbuild, React, remotion and @remotion/player come from its node_modules.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
export const findProject = (start) => {
    let dir = resolve(start);
    for (;;) {
        const pkgPath = join(dir, "package.json");
        if (existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if ((deps.remotion || deps["@remotion/cli"]) && pkg.name !== "reelnote") {
                    const name = typeof pkg.name === "string" && pkg.name && !pkg.name.startsWith("template-") ? pkg.name : basename(dir);
                    return { root: dir, name, pkg };
                }
            }
            catch {
                /* unreadable package.json: keep walking up */
            }
        }
        const up = dirname(dir);
        if (up === dir)
            return null;
        dir = up;
    }
};
const CONFIG_FILES = ["remotion.config.ts", "remotion.config.js", "remotion.config.mjs", "remotion.config.cjs"];
// A string passed to a Config.<method>("...") call in remotion.config.*, read as text (the config file is never executed).
export const configString = (root, method) => {
    for (const f of CONFIG_FILES) {
        const p = join(root, f);
        if (!existsSync(p))
            continue;
        const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
        const m = src.match(new RegExp(`${method}\\(\\s*["'\`]([^"'\`]+)["'\`]`));
        if (m)
            return m[1];
    }
    return null;
};
const ENTRY_CANDIDATES = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "src/index.mjs", "remotion/index.ts", "remotion/index.tsx", "app/remotion/index.ts", "src/remotion/index.ts", "src/remotion/index.tsx"];
export const findEntry = (root, explicit) => {
    const tryPath = (p) => {
        if (!p)
            return null;
        const abs = isAbsolute(p) ? p : join(root, p);
        return existsSync(abs) && statSync(abs).isFile() ? abs : null;
    };
    return tryPath(explicit) ?? tryPath(configString(root, "setEntryPoint")) ?? ENTRY_CANDIDATES.map(tryPath).find(Boolean) ?? null;
};
export const findPublicDir = (root) => {
    const custom = configString(root, "setPublicDir");
    return custom ? resolve(root, custom) : join(root, "public");
};
// require.resolve from the project folder, so every package exists exactly once (one React, one remotion).
export const projectRequire = (root) => createRequire(join(root, "package.json"));
export const resolveFromProject = (root, spec) => {
    try {
        return projectRequire(root).resolve(spec);
    }
    catch {
        return null;
    }
};
export const packageVersion = (root, name) => {
    const p = resolveFromProject(root, `${name}/package.json`);
    if (!p)
        return null;
    try {
        return JSON.parse(readFileSync(p, "utf8")).version ?? null;
    }
    catch {
        return null;
    }
};
// The public folder as Remotion's getStaticFiles() describes it (capped so huge asset folders stay fast).
export const listPublicFiles = (publicDir, base, limit = 5000) => {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (out.length >= limit)
                return;
            if (e.startsWith("."))
                continue;
            const p = join(dir, e);
            let st;
            try {
                st = statSync(p);
            }
            catch {
                continue;
            }
            if (st.isDirectory())
                walk(p);
            else {
                const name = relative(publicDir, p).split(sep).join("/");
                out.push({ name, src: `${base}/${name.split("/").map(encodeURIComponent).join("/")}`, sizeInBytes: st.size, lastModified: Math.round(st.mtimeMs) });
            }
        }
    };
    walk(publicDir);
    return out;
};
// Resolve rel inside base; null if it escapes base or isn't a file.
export const inside = (base, rel) => {
    let p;
    try {
        p = resolve(base, decodeURIComponent(rel).replace(/^[/\\]+/, ""));
    }
    catch {
        return null;
    }
    if (p !== base && !p.startsWith(base.endsWith(sep) ? base : base + sep))
        return null;
    try {
        return statSync(p).isFile() ? p : null;
    }
    catch {
        return null;
    }
};
