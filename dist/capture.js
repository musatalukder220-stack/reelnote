// Frame pictures come from the ReelNote window itself: exactly what you see, at the composition's own aspect.
// The window jumps to the frame, hides everything but the picture (and the marks, if asked), is photographed,
// then goes back to where you were.
import { writeFileSync } from "node:fs";
import { connectToPage } from "./cdp.js";
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
    const run = async (req) => {
        try {
            return await runInner(req);
        }
        catch (e) {
            throw clean(e);
        }
    };
    const runInner = async (req) => {
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
            const rect = await c.evaluate(`window.__reelnote.prepareCapture(${JSON.stringify({ composition: req.composition, frame: req.frame, marks: req.marks ?? null })})`);
            // Never ask for more pixels than the window shows: a larger capture makes Chrome re-lay the page, which can hang
            // with tall films. Retina screens still give twice the pixels. A minimized window can't paint, hence the timeout.
            const target = Math.min(req.width ?? 1600, rect.compWidth);
            const shot = await Promise.race([
                c.send("Page.captureScreenshot", {
                    format: "png", captureBeyondViewport: false,
                    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: Math.min(1, target / rect.width) },
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error("The frame picture timed out. Is the ReelNote window minimized?")), 20000)),
            ]);
            writeFileSync(req.file, Buffer.from(shot.data, "base64"));
            return req.file;
        }
        finally {
            await c.evaluate("window.__reelnote.finishCapture()").catch(() => { });
        }
    };
    // one capture at a time: they share the window
    const capture = (req) => {
        const p = chain.then(() => run(req), () => run(req));
        chain = p.catch(() => {
            cdp?.close();
            cdp = null;
        });
        return p;
    };
    return { capture, close: () => cdp?.close() };
};
