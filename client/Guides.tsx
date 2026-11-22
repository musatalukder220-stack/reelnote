// Guides drawn over the picture: a thirds grid, broadcast title/action safe areas, and the parts of a vertical
// video that TikTok, Reels and Shorts cover with their buttons and captions (approximate; the apps change).
import React from "react";

export type Guide = "none" | "thirds" | "safe" | "tiktok" | "reels" | "shorts";
export const GUIDES: Guide[] = ["none", "thirds", "safe", "tiktok", "reels", "shorts"];

// pixels kept clear on a 1080×1920 frame
export const PLATFORM_MARGINS: Record<"tiktok" | "reels" | "shorts", { top: number; bottom: number; left: number; right: number; label: string }> = {
  tiktok: { top: 130, bottom: 484, left: 44, right: 140, label: "TikTok" },
  reels: { top: 270, bottom: 672, left: 65, right: 120, label: "Reels" },
  shorts: { top: 120, bottom: 672, left: 48, right: 96, label: "Shorts" },
};

export const GuideLayer: React.FC<{ guide: Guide; width: number; height: number }> = ({ guide, width: W, height: H }) => {
  if (guide === "none") return null;
  const sw = Math.max(1.5, Math.min(W, H) / 400);
  const line = { stroke: "rgba(255,255,255,.75)", strokeWidth: sw, fill: "none", vectorEffect: "non-scaling-stroke" as const };
  if (guide === "thirds") {
    return (
      <g pointerEvents="none">
        {[1, 2].map((i) => <line key={`v${i}`} x1={(W * i) / 3} y1={0} x2={(W * i) / 3} y2={H} {...line} strokeDasharray="8 6" />)}
        {[1, 2].map((i) => <line key={`h${i}`} x1={0} y1={(H * i) / 3} x2={W} y2={(H * i) / 3} {...line} strokeDasharray="8 6" />)}
        <path d={`M${W / 2 - W / 60} ${H / 2} h${W / 30} M${W / 2} ${H / 2 - W / 60} v${W / 30}`} {...line} />
      </g>
    );
  }
  if (guide === "safe") {
    // EBU R95: action safe 93 %, title safe 90 % (graphics and text inside the inner box)
    const box = (pct: number, dash: string, label: string) => {
      const mx = (W * (1 - pct)) / 2, my = (H * (1 - pct)) / 2;
      return (
        <g>
          <rect x={mx} y={my} width={W - 2 * mx} height={H - 2 * my} {...line} strokeDasharray={dash} />
          <text x={mx + 8 * sw} y={my + 22 * sw} fontSize={14 * sw} fill="rgba(255,255,255,.8)" fontFamily="system-ui">{label}</text>
        </g>
      );
    };
    return <g pointerEvents="none">{box(0.93, "10 6", "action safe 93%")}{box(0.9, "3 5", "")}<text x={W * 0.05 + 8 * sw} y={H * 0.95 - 10 * sw} fontSize={14 * sw} fill="rgba(255,255,255,.8)" fontFamily="system-ui">title safe 90%</text></g>;
  }
  const m = PLATFORM_MARGINS[guide];
  const sx = W / 1080, sy = H / 1920;
  const t = m.top * sy, b = m.bottom * sy, l = m.left * sx, r = m.right * sx;
  const shade = { fill: "rgba(255, 70, 90, .28)" };
  return (
    <g pointerEvents="none">
      <rect x={0} y={0} width={W} height={t} {...shade} />
      <rect x={0} y={H - b} width={W} height={b} {...shade} />
      <rect x={0} y={t} width={l} height={H - t - b} {...shade} />
      <rect x={W - r} y={t} width={r} height={H - t - b} {...shade} />
      <rect x={l} y={t} width={W - l - r} height={H - t - b} {...line} strokeDasharray="10 6" />
      <text x={l + 10 * sw} y={t + 26 * sw} fontSize={18 * sw} fontWeight={700} fill="#fff" fontFamily="system-ui">{m.label} · safe area (approx.)</text>
    </g>
  );
};
