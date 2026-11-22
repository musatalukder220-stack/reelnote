// Shared shapes for notes, renders and checks. Coordinates in marks are composition pixels.

export type Mark =
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "pen"; points: [number, number][] };

export type Reply = { by: "you" | "claude"; text: string; at: string; name?: string }; // name: a reviewer who replied

export type NoteStatus = "open" | "fixed";
export type NoteKind = "visual" | "audio";

export type FixRecord = {
  from: string; // snapshot id before Claude's change
  to: string; // snapshot id when the note was marked fixed
  files: { path: string; added: number; removed: number }[];
  at: string;
  undone: boolean;
};

export type Note = {
  id: number;
  composition: string;
  frame: number;
  endFrame: number | null;
  fps: number;
  width: number;
  height: number;
  kind: NoteKind;
  text: string;
  marks: Mark[];
  image: string | null; // relative to .reelnote/, with marks
  clean: string | null; // relative to .reelnote/, without marks (the "before" picture)
  strip: string | null; // relative to .reelnote/: frames across the range, side by side
  status: NoteStatus;
  replies: Reply[];
  created: string;
  fixed: string | null;
  author: string | null; // a reviewer's name; null = you
  props: Record<string, unknown> | null; // props changed in the props editor when the note was written
  createdSnap: string | null; // project snapshot when the note was written
  baseline: string | null; // project snapshot when Claude started on it
  fix: FixRecord | null;
};

export type Codec = "h264" | "h265" | "vp9" | "prores" | "gif";

export type RenderSettings = {
  codec: Codec;
  scale: number;
  crf: number | null;
  concurrency: "auto" | number;
  range: [number, number] | null;
  muted: boolean;
};

export type Issue = {
  level: "error" | "warning" | "info";
  kind: "flash" | "black-flash" | "white-flash" | "stutter" | "frozen" | "missing-frames" | "silence" | "clipping" | "no-audio" | "loudness";
  frame: number;
  endFrame?: number;
  message: string;
};

export type VideoCheck = { frames: number; expected: number | null; issues: Issue[] };

export type AudioCheck = {
  hasAudio: boolean;
  frames: number;
  fps: number;
  peaks: number[]; // one value per video frame, 0..1
  rmsDb: number | null;
  peakDb: number | null;
  lufs: number | null; // integrated loudness (BS.1770); YouTube aims for about -14
  issues: Issue[];
};

export type Memory = {
  platform: NodeJS.Platform;
  totalGB: number;
  availableMB: number;
  usedGB: number;
  swapUsedGB: number | null;
  pressure: "normal" | "warning" | "critical";
};

export type JobKind = "video" | "waveform";
export type JobStatus = "queued" | "bundling" | "rendering" | "encoding" | "checking" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  kind: JobKind;
  composition: string;
  settings: RenderSettings;
  concurrency: number;
  out: string; // relative to project root
  status: JobStatus;
  rendered: number;
  encoded: number;
  total: number | null;
  checked: number;
  eta: string | null;
  startedAt: number;
  finishedAt: number | null;
  memory: Memory | null;
  minAvailableMB: number | null;
  maxSwapGB: number | null;
  sizeMB: number | null;
  video: VideoCheck | null;
  audio: AudioCheck | null;
  error: string | null;
  log: string[];
  previous: string | null; // the render this one replaced, kept for comparison (relative to project root)
  diff: RenderDiff | null;
};

export type RenderDiff = { frames: [number, number]; changed: { from: number; to: number; amount: number }[]; at: string };

export type QueueItem = {
  id: string; kind: JobKind; composition: string; settings: RenderSettings; durationInFrames: number | null; fps: number | null; added: number;
  props: Record<string, unknown> | null; // props from the props editor, rendered with --props
};

export type CompositionInfo = {
  id: string;
  folder: string | null;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  still: boolean;
  error?: string;
};

export type ServerInfo = { port: number; token: string; devtoolsPort: number | null; pid: number; root: string; started: string; version: string };
