// A small Chrome DevTools Protocol client with no dependencies: enough to run code in the ReelNote window
// and take exact pictures of a frame.
import { join } from "node:path";
import { createRequire } from "node:module";
import { sleep } from "./util.js";

type WS = {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
};
type WSCtor = new (url: string) => WS;

const webSocket = (root: string): WSCtor => {
  const g = globalThis as unknown as { WebSocket?: WSCtor };
  if (typeof g.WebSocket === "function") return g.WebSocket;
  // Node 20 has no global WebSocket: borrow `ws` from the Remotion project (the Remotion CLI depends on it)
  return createRequire(join(root, "package.json"))("ws") as WSCtor;
};

export type Cdp = {
  send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => Promise<T>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  close: () => void;
  closed: () => boolean;
};

export const connectToPage = async (opts: { root: string; port: number; urlPrefix: string; timeoutMs?: number }): Promise<Cdp> => {
  const deadline = Date.now() + (opts.timeoutMs ?? 20000);
  let target: { webSocketDebuggerUrl: string } | null = null;
  while (!target && Date.now() < deadline) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page" && t.url.startsWith(opts.urlPrefix)) ?? null;
    } catch {
      /* the browser is still starting */
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("Could not reach the ReelNote window. Is it open?");
  const Ctor = webSocket(opts.root);
  const ws = new Ctor(target.webSocketDebuggerUrl);
  let isClosed = false;
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error(`DevTools connection failed: ${(e as { message?: string })?.message ?? "unknown error"}`));
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.onclose = () => {
    isClosed = true;
    for (const p of pending.values()) p.reject(new Error("The ReelNote window closed."));
    pending.clear();
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      if (isClosed) return reject(new Error("The ReelNote window closed."));
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T>(expression: string) => {
    const r = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close(), closed: () => isClosed };
};
