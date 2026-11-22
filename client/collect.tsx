// Finds the film's compositions by rendering its Root once, off screen, with ReelNote's <Composition> recorder.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CollectorContext, type Registered } from "./shim";
import type { Comp } from "./types";

export const collectCompositions = async (): Promise<Comp[]> => {
  const Root = (globalThis as unknown as { __reelnoteRoot?: React.FC }).__reelnoteRoot;
  if (!Root) throw new Error("Your entry file didn't call registerRoot().");
  const found = new Map<string, Registered>();
  const el = document.createElement("div");
  const root = createRoot(el);
  flushSync(() => root.render(<CollectorContext.Provider value={{ add: (c) => found.set(c.id, c) }}><Root /></CollectorContext.Provider>));
  // roots that register compositions after an effect get one more tick
  await new Promise((r) => setTimeout(r, 30));
  root.unmount();

  const out: Comp[] = [];
  for (const c of found.values()) {
    let props = { ...(c.defaultProps ?? {}) };
    let meta: Record<string, unknown> = {};
    let error: string | undefined;
    if (c.calculateMetadata) {
      try {
        meta = (await c.calculateMetadata({ defaultProps: props, props, abortSignal: new AbortController().signal, compositionId: c.id, isRendering: false })) ?? {};
        if (meta.props) props = { ...props, ...(meta.props as Record<string, unknown>) };
      } catch (e) {
        error = `calculateMetadata failed: ${(e as Error).message}`;
      }
    }
    const num = (k: "durationInFrames" | "fps" | "width" | "height", def: number) => {
      const v = Number(meta[k] ?? c[k]);
      return Number.isFinite(v) && v > 0 ? v : def;
    };
    out.push({
      id: c.id, folder: c.folder, still: c.still, component: c.component, lazyComponent: c.lazyComponent, props, defaults: props, error,
      calc: c.calculateMetadata,
      durationInFrames: c.still ? 1 : Math.round(num("durationInFrames", 1)), fps: num("fps", 30), width: Math.round(num("width", 1920)), height: Math.round(num("height", 1080)),
    });
  }
  return out;
};
