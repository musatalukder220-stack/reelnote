// Frame pictures come from the ReelNote window itself: exactly what you see, at the composition's own aspect.
// The window jumps to the frame, hides everything but the picture (and the marks, if asked), is photographed,
// then goes back to where you were. A filmstrip photographs several frames and lays them side by side.
import { writeFileSync } from "node:fs";
import { connectToPage } from "./cdp.js";
// frames spread evenly over a range, first and last included
export const stripFrames = (from, to, count = 12) => {
    const n = Math.max(1, Math.min(count, to - from + 1));
    if (n === 1)
        return [from];
    return Array.from(new Set(Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)))));
};
export const createCapturer = (opts) => {
    let cdp = null;
    let chain = Promise.resolve();
    const get = async () => {
        if (cdp && !cdp.closed())
            return cdp;
        const port = opts.devtoolsPort();
        if (!port)
            throw new Error("The ReelNote window isn't open (started with --no-window). Frame pictures need it.");
        cdp = await connectToPage({ root: opts.root, port, urlPrefix: opts.appUrl });
        return cdp;
    };
    // errors from the page arrive with a stack trace: keep the sentence
    const clean = (e) => new Error(String(e.message ?? e).split("\n")[0].replace(/^(Type)?Error:\s*/, ""));
    const shoot = async (c, rect, width) => {
        // Never ask for more pixels than the window shows: a larger capture makes Chrome re-lay the page, which can hang
        // with tall films. Retina screens still give twice the pixels. A minimized window can't paint, hence the timeout.
        const target = Math.min(width, rect.compWidth);
        const shot = await Promise.race([
            c.send("Page.captureScreenshot", {
                format: "png", captureBeyondViewport: false,
                clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: Math.min(1, target / rect.width) },
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("The frame picture timed out. Is the ReelNote window minimized?")), 20000)),
        ]);
        return shot.data;
    };
    const session = async (composition, frame, marks, fn) => {
        const c = await get();
        // the window may be reloading after a code change: wait until the film is loaded again
        await c.evaluate(`new Promise((res, rej) => {
      const t0 = Date.now();
      const tick = () => window.__reelnote ? res(true)
        : Date.now() - t0 > 20000 ? rej(new Error("The ReelNote window hasn't finished loading the film (is there an error in the code?)"))
        : setTimeout(tick, 100);
      tick();
    })`);
        try {
            const rect = await c.evaluate(`window.__reelnote.prepareCapture(${JSON.stringify({ composition, frame, marks })})`);
            return await fn(c, rect);
        }
        finally {
            await c.evaluate("window.__reelnote.finishCapture()").catch(() => { });
        }
    };
    const one = (req) => session(req.composition, req.frame, req.marks ?? null, async (c, rect) => {
        writeFileSync(req.file, Buffer.from(await shoot(c, rect, req.width ?? 1600), "base64"));
        return req.file;
    });
    const strip = (req) => {
        const frames = stripFrames(req.from, req.to, req.count);
        return session(req.composition, frames[0], null, async (c, first) => {
            const shots = [];
            for (const f of frames) {
                const rect = f === frames[0] ? first : await c.evaluate(`window.__reelnote.moveTo(${f})`);
                shots.push(await shoot(c, rect, 480));
            }
            const url = await c.evaluate(`window.__reelnote.composeStrip(${JSON.stringify({ images: shots, labels: frames.map(String) })})`);
            writeFileSync(req.file, Buffer.from(url.replace(/^data:image\/\w+;base64,/, ""), "base64"));
            return { file: req.file, frames };
        });
    };
    // one at a time: they share the window
    const queue = (fn) => {
        const p = chain.then(fn, fn).catch((e) => {
            throw clean(e);
        });
        chain = p.catch(() => {
            cdp?.close();
            cdp = null;
        });
        return p;
    };
    return {
        capture: (req) => queue(() => one(req)),
        strip: (req) => queue(() => strip(req)),
        close: () => cdp?.close(),
    };
};
