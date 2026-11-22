// The timeline under the picture: playhead, notes (pins and ranges), the selected range, the sound and render problems.
import React, { useEffect, useRef, useState } from "react";
import { useT } from "./i18n";
import { LiveThumb } from "./LiveThumb";
import type { Comp, Issue, Note } from "./types";

type Props = {
  duration: number; fps: number; frame: number; notes: Note[]; selected: number | null; range: [number, number] | null;
  peaks: number[] | null; issues: Issue[]; waveBusy: boolean; comp: Comp; thumbs: boolean; canWave: boolean;
  onSeek: (f: number) => void; onScrub: (on: boolean) => void; onRange: (r: [number, number] | null) => void; onPick: (id: number) => void; onWave: () => void;
};

const niceStep = (seconds: number) => [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => seconds / s <= 12) ?? 1200;

export const Timeline: React.FC<Props> = (p) => {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ mode: "seek" | "range"; from: number } | null>(null);
  const last = Math.max(1, p.duration - 1);
  const pct = (f: number) => `${(Math.min(last, Math.max(0, f)) / last) * 100}%`;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // waveform: max peak per pixel column
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 34;
    c.width = Math.max(1, Math.round(width * dpr));
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (!p.peaks?.length) return;
    g.fillStyle = "rgba(122, 162, 255, .55)";
    const cols = c.width;
    for (let x = 0; x < cols; x++) {
      const a = Math.floor((x / cols) * p.duration), b = Math.max(a + 1, Math.floor(((x + 1) / cols) * p.duration));
      let v = 0;
      for (let i = a; i < b && i < p.peaks.length; i++) v = Math.max(v, p.peaks[i]);
      const bh = Math.max(dpr, Math.sqrt(v) * c.height);
      g.fillRect(x, (c.height - bh) / 2, 1, bh);
    }
  }, [p.peaks, width, p.duration]);

  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last);
  };
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".pin, .tl-wave-btn")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = frameAt(e.clientX);
    if (e.shiftKey) {
      drag.current = { mode: "range", from: f };
      p.onRange([f, f]);
    } else {
      drag.current = { mode: "seek", from: f };
      p.onScrub(true);
      p.onSeek(f);
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const f = frameAt(e.clientX);
    if (drag.current.mode === "range") p.onRange([Math.min(drag.current.from, f), Math.max(drag.current.from, f)]);
    else p.onSeek(f);
  };
  const up = () => {
    if (drag.current?.mode === "seek") p.onScrub(false);
    if (drag.current?.mode === "range" && p.range && p.range[0] === p.range[1]) p.onRange(null);
    drag.current = null;
  };

  const seconds = p.duration / p.fps;
  const step = niceStep(seconds);
  const ticks: number[] = [];
  for (let s = 0; s <= seconds + 1e-6; s += step) ticks.push(s);

  const nThumbs = Math.max(2, Math.min(14, Math.floor(width / 96)));
  const thumbFrames = Array.from({ length: nThumbs }, (_, i) => Math.round((i * last) / (nThumbs - 1)));

  return (
    <div className="timeline">
      {p.thumbs && p.duration > 1 && (
        <div className="tl-thumbs" key={`${p.comp.id}-${nThumbs}`}>
          {thumbFrames.map((f, i) => <div key={i} className="tl-thumb" onClick={() => p.onSeek(f)}><LiveThumb comp={p.comp} frame={f} delay={120 * i} /></div>)}
        </div>
      )}
      <div className="tl-ruler">
        {ticks.map((s) => (
          <span key={s} style={{ left: pct(s * p.fps) }}>{s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s}s`}</span>
        ))}
      </div>
      <div className="tl-track" ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Shift + drag: select a range">
        <canvas ref={canvas} className="tl-wave" style={{ width: "100%", height: 34 }} />
        {!p.peaks && p.canWave && (
          <button className="tl-wave-btn" onClick={p.onWave} disabled={p.waveBusy}>{p.waveBusy ? t.waveformBuilding : `♪ ${t.waveform}`}</button>
        )}
        {p.range && <div className="tl-range" style={{ left: pct(p.range[0]), width: `calc(${pct(p.range[1])} - ${pct(p.range[0])})` }} />}
        {p.issues.map((i, k) => (
          <div key={`i${k}`} className={`tl-issue ${i.level}`} title={i.message}
            style={{ left: pct(i.frame), width: i.endFrame !== undefined ? `max(2px, calc(${pct(i.endFrame)} - ${pct(i.frame)}))` : 2 }} />
        ))}
        {p.notes.map((n) => (
          <div key={n.id} className={`pin ${n.status}${p.selected === n.id ? " sel" : ""}${n.kind === "audio" ? " audio" : ""}`}
            style={{ left: pct(n.frame), width: n.endFrame !== null ? `calc(${pct(n.endFrame)} - ${pct(n.frame)})` : undefined }}
            title={`#${n.id} ${n.text}`} onPointerDown={(e) => { e.stopPropagation(); p.onPick(n.id); }}>
            <b>{n.id}</b>
          </div>
        ))}
        <div className="tl-head" style={{ left: pct(p.frame) }} />
      </div>
    </div>
  );
};
