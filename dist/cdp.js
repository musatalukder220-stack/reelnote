// A small Chrome DevTools Protocol client with no dependencies: enough to run code in the ReelNote window
// and take exact pictures of a frame.
import { join } from "node:path";
import { createRequire } from "node:module";
import { sleep } from "./util.js";
const webSocket = (root) => {
    const g = globalThis;
    if (typeof g.WebSocket === "function")
        return g.WebSocket;
    // Node 20 has no global WebSocket: borrow `ws` from the Remotion project (the Remotion CLI depends on it)
    return createRequire(join(root, "package.json"))("ws");
};
export const connectToPage = async (opts) => {
    const deadline = Date.now() + (opts.timeoutMs ?? 20000);
    let target = null;
    while (!target && Date.now() < deadline) {
        try {
            const list = (await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json());
            target = list.find((t) => t.type === "page" && t.url.startsWith(opts.urlPrefix)) ?? null;
        }
        catch {
            /* the browser is still starting */
        }
        if (!target)
            await sleep(250);
    }
    if (!target)
        throw new Error("Could not reach the ReelNote window. Is it open?");
    const Ctor = webSocket(opts.root);
    const ws = new Ctor(target.webSocketDebuggerUrl);
    let isClosed = false;
    await new Promise((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = (e) => rej(new Error(`DevTools connection failed: ${e?.message ?? "unknown error"}`));
    });
    let seq = 0;
    const pending = new Map();
    ws.onclose = () => {
        isClosed = true;
        for (const p of pending.values())
            p.reject(new Error("The ReelNote window closed."));
        pending.clear();
    };
    ws.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error)
                p.reject(new Error(msg.error.message));
            else
                p.resolve(msg.result);
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        if (isClosed)
            return reject(new Error("The ReelNote window closed."));
        const id = ++seq;
        pending.set(id, { resolve: resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", {
            expression, awaitPromise: true, returnByValue: true,
        });
        if (r.exceptionDetails)
            throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
    };
    return { send, evaluate, close: () => ws.close(), closed: () => isClosed };
};
