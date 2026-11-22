// Drawing marks on the picture (in composition pixels) and showing them again.
import React from "react";
import type { Mark, Tool } from "./types";

export const MARK_COLOR = "#ffd23f";
export const FIXED_COLOR = "#3ddc84";

const markerId = (color: string) => `rn-arrow-${color.replace("#", "")}`;

export const ArrowDefs = () => (
  <defs>
    {[MARK_COLOR, FIXED_COLOR].map((c) => (
      <marker key={c} id={markerId(c)} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
      </marker>
    ))}
  </defs>
);

export const MarkShape: React.FC<{ mark: Mark; stroke: number; color?: string; label?: string }> = ({ mark: m, stroke, color = MARK_COLOR, label }) => {
  const common = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const shadow = { ...common, stroke: "rgba(0,0,0,.55)", strokeWidth: stroke * 2.1 };
  let shape: React.ReactNode, shadowShape: React.ReactNode, lx = 0, ly = 0;
  switch (m.type) {
    case "ellipse":
      shape = <ellipse cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} {...common} />;
      shadowShape = <ellipse cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} {...shadow} />;
      lx = m.cx + m.rx * 0.72;
      ly = m.cy - m.ry * 0.72;
      break;
    case "rect":
      shape = <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={stroke} {...common} />;
      shadowShape = <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={stroke} {...shadow} />;
      lx = m.x + m.w;
      ly = m.y;
      break;
    case "arrow":
      shape = <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} {...common} markerEnd={`url(#${markerId(color)})`} />;
      shadowShape = <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} {...shadow} />;
      lx = m.x1;
      ly = m.y1;
      break;
    case "pen": {
      const d = m.points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
      shape = <path d={d} {...common} />;
      shadowShape = <path d={d} {...shadow} />;
      lx = m.points[0]?.[0] ?? 0;
      ly = m.points[0]?.[1] ?? 0;
    }
  }
  const r = stroke * 4.2;
  return (
    <g>
      {shadowShape}
      {shape}
      {label && (
        <g transform={`translate(${lx} ${ly})`}>
          <circle r={r} fill={color} stroke="rgba(0,0,0,.6)" strokeWidth={stroke * 0.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.15} fontWeight={800} fill="#14162b" fontFamily="system-ui, sans-serif">{label}</text>
        </g>
      )}
    </g>
  );
};

// a mark from a drag between two points (composition pixels)
export const markFromDrag = (tool: Tool, a: [number, number], b: [number, number], pen: [number, number][]): Mark | null => {
  const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  switch (tool) {
    case "ellipse":
      return { type: "ellipse", cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.max(4, w / 2), ry: Math.max(4, h / 2) };
    case "rect":
      return { type: "rect", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.max(4, w), h: Math.max(4, h) };
    case "arrow":
      return Math.hypot(w, h) < 6 ? null : { type: "arrow", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
    case "pen":
      return pen.length < 2 ? null : { type: "pen", points: simplify(pen, 1.5) };
  }
};

// Ramer–Douglas–Peucker: fewer points, same stroke
export const simplify = (pts: [number, number][], eps: number): [number, number][] => {
  if (pts.length < 3) return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const num = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]);
    const den = Math.hypot(b[1] - a[1], b[0] - a[0]) || 1;
    const d = num / den;
    if (d > max) [max, idx] = [d, i];
  }
  if (max <= eps) return [a, b].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) as [number, number][];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
};

const r1 = (v: number) => Math.round(v * 10) / 10;
export const roundMark = (m: Mark): Mark => {
  switch (m.type) {
    case "ellipse": return { type: "ellipse", cx: r1(m.cx), cy: r1(m.cy), rx: r1(m.rx), ry: r1(m.ry) };
    case "rect": return { type: "rect", x: r1(m.x), y: r1(m.y), w: r1(m.w), h: r1(m.h) };
    case "arrow": return { type: "arrow", x1: r1(m.x1), y1: r1(m.y1), x2: r1(m.x2), y2: r1(m.y2) };
    case "pen": return { type: "pen", points: m.points.map(([x, y]) => [r1(x), r1(y)] as [number, number]) };
  }
};
