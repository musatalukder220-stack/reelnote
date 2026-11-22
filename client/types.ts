import type React from "react";

export type Mark =
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "pen"; points: [number, number][] };
export type Tool = Mark["type"];

export type Reply = { by: "you" | "claude"; text: string; at: string };
export type Note = {
  id: number; composition: string; frame: number; endFrame: number | null; fps: number; width: number; height: number;
  kind: "visual" | "audio"; text: string; marks: Mark[]; image: string | null; clean: string | null;
  status: "open" | "fixed"; replies: Reply[]; created: string; fixed: string | null;
};

export type Comp = {
  id: string; folder: string | null; durationInFrames: number; fps: number; width: number; height: number; still: boolean;
  component?: React.ComponentType<Record<string, unknown>>;
  lazyComponent?: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>;
  props: Record<string, unknown>;
  error?: string;
};

export type Codec = "h264" | "h265" | "vp9" | "prores" | "gif";
export type RenderSettings = { codec: Codec; scale: number; crf: number | null; concurrency: "auto" | number; range: [number, number] | null; muted: boolean };

export type Issue = { level: "error" | "warning" | "info"; kind: string; frame: number; endFrame?: number; message: string };
export type Memory = { platform: string; totalGB: number; availableMB: number; usedGB: number; swapUsedGB: number | null; pressure: "normal" | "warning" | "critical" } | null;

export type Job = {
  id: string; kind: "video" | "waveform"; composition: string; settings: RenderSettings; concurrency: number; out: string;
  status: "queued" | "bundling" | "rendering" | "encoding" | "checking" | "done" | "failed" | "cancelled";
  rendered: number; encoded: number; total: number | null; checked: number; eta: string | null; startedAt: number; finishedAt: number | null;
  memory: Memory; minAvailableMB: number | null; maxSwapGB: number | null; sizeMB: number | null;
  video: { frames: number; expected: number | null; issues: Issue[] } | null;
  audio: { hasAudio: boolean; rmsDb: number | null; peakDb: number | null; issues: Issue[] } | null;
  error: string | null; log: string[]; minutes?: number;
};
export type QueueItem = { id: string; kind: "video" | "waveform"; composition: string; settings: RenderSettings };
export type RenderState = { job: Job | null; queue: QueueItem[]; waiting: string | null; history: Job[] };
export type Waveform = { composition: string; peaks: number[]; fps: number; issues: Issue[]; rmsDb: number | null; peakDb: number | null; hasAudio: boolean; made: string };
export type Activity = { text: string; at: number };
export type Settings = { lang: "en" | "bn"; render: RenderSettings };
