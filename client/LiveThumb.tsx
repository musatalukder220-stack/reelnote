// A live picture of one frame, straight from the code (Remotion's <Thumbnail>), drawn only when it scrolls into view.
// It updates by itself after a code change, because the whole window reloads.
import { Thumbnail } from "@remotion/player";
import React, { useEffect, useRef, useState } from "react";
import { ArrowDefs, MarkShape } from "./marks";
import type { Comp, Mark } from "./types";

export const LiveThumb: React.FC<{ comp: Comp; frame: number; marks?: Mark[]; delay?: number; className?: string; title?: string }> = ({ comp, frame, marks, delay = 0, className, title }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        timer = setTimeout(() => setShow(true), delay);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [delay]);
  const f = Math.max(0, Math.min(comp.durationInFrames - 1, frame));
  const stroke = Math.max(3, Math.min(comp.width, comp.height) / 160);
  return (
    <div ref={ref} className={`live-thumb ${className ?? ""}`} style={{ aspectRatio: `${comp.width} / ${comp.height}` }} title={title}>
      {show && (
        <Thumbnail
          {...(comp.lazyComponent ? { lazyComponent: comp.lazyComponent } : { component: comp.component! })}
          inputProps={comp.props}
          compositionWidth={comp.width}
          compositionHeight={comp.height}
          durationInFrames={comp.durationInFrames}
          fps={comp.fps}
          frameToDisplay={f}
          className="rn-film"
          style={{ width: "100%", height: "100%" }}
          errorFallback={() => <div className="thumb-error">!</div>}
        />
      )}
      {show && marks && marks.length > 0 && (
        <svg className="thumb-marks" viewBox={`0 0 ${comp.width} ${comp.height}`}>
          <ArrowDefs />
          {marks.map((m, i) => <MarkShape key={i} mark={m} stroke={stroke} color="rgba(255,210,63,.7)" />)}
        </svg>
      )}
    </div>
  );
};
