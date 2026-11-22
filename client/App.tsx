// The ReelNote window: picture, timeline, marking tools, notes, render and tools.
import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, boot, fileUrl, on } from "./api";
import { dicts, LangContext, type Lang } from "./i18n";
import { ArrowDefs, FIXED_COLOR, MarkShape, markFromDrag, MARK_COLOR, roundMark } from "./marks";
import { NotesPanel, noteRange } from "./NotesPanel";
import { MemBar, RenderPanel } from "./RenderPanel";
import { Timeline } from "./Timeline";
import { KeyList, ToolsPanel } from "./ToolsPanel";
import type { Activity, Comp, Issue, Job, Mark, Memory, Note, RenderState, Settings, Tool, Waveform } from "./types";

type Draft = { kind: "visual" | "audio"; tool: Tool; marks: Mark[]; text: string; saving: boolean };
type Drag = { a: [number, number]; b: [number, number]; pen: [number, number][] };
const TOOLS: Tool[] = ["ellipse", "rect", "arrow", "pen"];
const TOOL_ICON: Record<Tool, string> = { ellipse: "◯", rect: "▢", arrow: "➚", pen: "✎" };
const ACTIVE = ["queued", "bundling", "rendering", "encoding", "checking"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const readHash = () => {
  const m = decodeURIComponent(location.hash.slice(1)).match(/^(.*)@(\d+)$/);
  return m ? { comp: m[1], frame: Number(m[2]) } : null;
};

export const App: React.FC<{ comps: Comp[] }> = ({ comps }) => {
  const start = readHash();
  const [compId, setCompId] = useState(() => (start && comps.some((c) => c.id === start.comp) ? start.comp : comps[0]?.id ?? ""));
  const comp = comps.find((c) => c.id === compId) ?? null;
  const [frame, setFrame] = useState(() => (start && start.comp === compId ? start.frame : 0));
  const [playing, setPlaying] = useState(false);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [rq, setRq] = useState<RenderState>({ job: null, queue: [], waiting: null, history: [] });
  const [job, setJob] = useState<Job | null>(null);
  const [mem, setMem] = useState<Memory>(null);
  const [settings, setSettings] = useState<Settings>({ lang: boot.lang, render: { codec: "h264", scale: 1, crf: null, concurrency: "auto", range: null, muted: false } });
  const [acts, setActs] = useState<Activity[]>([]);
  const [tab, setTab] = useState<"notes" | "render" | "tools">("notes");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lastTool, setLastTool] = useState<Tool>("ellipse");
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<Note | null>(null);
  const [split, setSplit] = useState(0.5);
  const [showMarks, setShowMarks] = useState(false);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [waves, setWaves] = useState<Record<string, Waveform | null>>({});
  const [help, setHelp] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(boot.buildError);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [capture, setCapture] = useState<{ marks: Mark[] | null } | null>(null);
  const [box, setBox] = useState({ w: 960, h: 540 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const buffering = useRef(false);
  const t = dicts[settings.lang];

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((s: string) => {
    setToastMsg(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  // ---------- data from the server ----------
  useEffect(() => {
    api<{ notes: Note[]; render: RenderState; memory: Memory; settings: Settings }>("state").then((s) => {
      setNotes(s.notes);
      setRq(s.render);
      setJob(s.render.job);
      setMem(s.memory);
      setSettings(s.settings);
    }).catch((e: Error) => toast(e.message));
    api("compositions", { body: { compositions: comps.map(({ component: _c, lazyComponent: _l, props: _p, ...rest }) => rest) } }).catch(() => {});
    const offs = [
      on<Note[]>("notes", setNotes),
      on<RenderState>("render", (r) => { setRq(r); setJob(r.job); }),
      on<Job>("job", setJob),
      on<Activity>("activity", (a) => setActs((x) => [...x.slice(-5), a])),
      on<{ composition: string }>("waveform", ({ composition }) => loadWave(composition)),
    ];
    (window as unknown as { __rnShowError: (s: string) => void }).__rnShowError = setBuildError;
    const memTimer = setInterval(() => api<Memory>("memory").then(setMem).catch(() => {}), 5000);
    return () => {
      offs.forEach((f) => f());
      clearInterval(memTimer);
    };
  }, []);

  const loadWave = (id: string) =>
    api<Waveform>(`waveform?composition=${encodeURIComponent(id)}`).then((w) => setWaves((x) => ({ ...x, [id]: w }))).catch(() => setWaves((x) => ({ ...x, [id]: null })));
  useEffect(() => {
    if (compId && !(compId in waves)) loadWave(compId);
  }, [compId]);

  const saveSettings = (s: Settings) => {
    setSettings(s);
    api("settings", { method: "PUT", body: s }).catch(() => {});
  };

  // ---------- player ----------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = comp ? Math.min(box.w / comp.width, box.h / comp.height) : 1;
  const last = comp ? comp.durationInFrames - 1 : 0;

  useEffect(() => {
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWait = () => (buffering.current = true);
    const onResume = () => (buffering.current = false);
    player.addEventListener("waiting", onWait);
    player.addEventListener("resume", onResume);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("waiting", onWait);
      player.removeEventListener("resume", onResume);
    };
  }, [player]);

  const seek = useCallback((f: number) => {
    const c = Math.max(0, Math.min(last, Math.round(f)));
    player?.seekTo(c);
    setFrame(c);
  }, [player, last]);

  const toggle = () => {
    if (!player) return;
    if (player.isPlaying()) player.pause();
    else {
      if (frame >= last) player.seekTo(0);
      player.play();
    }
  };

  // remember where you were across reloads (code changes)
  useEffect(() => {
    const id = setTimeout(() => history.replaceState(null, "", `#${encodeURIComponent(compId)}@${frame}`), 150);
    return () => clearTimeout(id);
  }, [compId, frame]);
  useEffect(() => {
    (window as unknown as { __rnBeforeReload: () => void }).__rnBeforeReload = () => history.replaceState(null, "", `#${encodeURIComponent(compId)}@${frame}`);
  }, [compId, frame]);

  const switchComp = (id: string, f = 0) => {
    if (id === compId) return seek(f);
    setCompId(id);
    setFrame(f);
    setRange(null);
    setCompare(null);
    setDraft(null);
  };

  // ---------- notes ----------
  const compNotes = useMemo(() => notes.filter((n) => n.composition === compId), [notes, compId]);
  const openCount = notes.filter((n) => n.status === "open").length;

  const startNote = (kind: "visual" | "audio") => {
    if (!comp) return;
    player?.pause();
    setCompare(null);
    if (range) seek(range[0]);
    setDraft({ kind, tool: lastTool, marks: [], text: "", saving: false });
    setTimeout(() => textRef.current?.focus(), 30);
  };

  const saveNote = async () => {
    if (!draft || !comp || draft.saving) return;
    if (!draft.text.trim() && !draft.marks.length) return setDraft(null);
    setDraft({ ...draft, saving: true });
    const at = range ? range[0] : frame;
    try {
      const n = await api<Note>("notes", { body: {
        composition: comp.id, frame: at, endFrame: range && range[1] > range[0] ? range[1] : null, fps: comp.fps, width: comp.width, height: comp.height,
        kind: draft.kind, text: draft.text, marks: draft.kind === "visual" ? draft.marks : [],
      } });
      setDraft(null);
      setRange(null);
      setSelected(n.id);
      toast(`${t.saved} · #${n.id}`);
    } catch (e) {
      setDraft((d) => (d ? { ...d, saving: false } : d));
      toast((e as Error).message);
    }
  };

  const goNote = (n: Note) => {
    setSelected(n.id);
    setCompare(null);
    player?.pause();
    switchComp(n.composition, n.frame);
    if (n.composition === compId) seek(n.frame);
  };
  const openCompare = (n: Note) => {
    goNote(n);
    setCompare(n);
    setSplit(0.5);
  };
  const stepNote = (dir: 1 | -1) => {
    const sorted = compNotes.slice().sort((a, b) => a.frame - b.frame);
    const next = dir > 0 ? sorted.find((n) => n.frame > frame) : sorted.reverse().find((n) => n.frame < frame);
    if (next) goNote(next);
  };

  // ---------- keys ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else if (compare) setCompare(null);
        else if (help) setHelp(false);
        else setRange(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        if (draft && (e.metaKey || e.ctrlKey) && e.key === "z") {
          e.preventDefault();
          setDraft((d) => (d ? { ...d, marks: d.marks.slice(0, -1) } : d));
        }
        return;
      }
      const k = e.key;
      if (k === " ") {
        e.preventDefault();
        toggle();
      } else if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault();
        player?.pause();
        seek(frame + (k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
      } else if (k === "Home") seek(0);
      else if (k === "End") seek(last);
      else if (k === "n" || k === "N") {
        e.preventDefault();
        startNote("visual");
      } else if (k === "a" || k === "A") {
        e.preventDefault();
        startNote("audio");
      } else if (k === "i" || k === "I") setRange((r) => [frame, r && r[1] >= frame ? r[1] : frame]);
      else if (k === "o" || k === "O") setRange((r) => [r && r[0] <= frame ? r[0] : frame, frame]);
      else if (k === "x" || k === "X") setRange(null);
      else if (k === "[") stepNote(-1);
      else if (k === "]") stepNote(1);
      else if (k === "?") setHelp((h) => !h);
      else if (draft && /^[1-4]$/.test(k)) {
        const tool = TOOLS[Number(k) - 1];
        setLastTool(tool);
        setDraft({ ...draft, tool });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- drawing ----------
  const toComp = (e: React.PointerEvent): [number, number] => {
    const r = frameRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * comp!.width, ((e.clientY - r.top) / r.height) * comp!.height];
  };
  // the drag lives in a ref (events can arrive faster than React renders) and is mirrored to state for the preview
  const dragRef = useRef<Drag | null>(null);
  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const drawDown = (e: React.PointerEvent) => {
    if (!draft || draft.kind !== "visual") return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toComp(e);
    setDragBoth({ a: p, b: p, pen: [p] });
  };
  const drawMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toComp(e);
    setDragBoth({ ...d, b: p, pen: draft?.tool === "pen" ? [...d.pen, p] : d.pen });
  };
  const drawUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !draft) return;
    const p = toComp(e);
    const m = markFromDrag(draft.tool, d.a, p, draft.tool === "pen" ? [...d.pen, p] : d.pen);
    setDragBoth(null);
    if (m) setDraft((x) => (x ? { ...x, marks: [...x.marks, roundMark(m)] } : x));
    setTimeout(() => textRef.current?.focus(), 0);
  };
  const dragMark = drag && draft ? markFromDrag(draft.tool, drag.a, drag.b, drag.pen) : null;

  // ---------- frame pictures for Claude (called by the server through DevTools) ----------
  const ctl = useRef({ compId, frame, playing, player, comps, seek, switchComp });
  ctl.current = { compId, frame, playing, player, comps, seek, switchComp };
  useEffect(() => {
    let saved: { compId: string; frame: number; playing: boolean } | null = null;
    const waitFor = async (ok: () => boolean, ms = 8000) => {
      const end = Date.now() + ms;
      while (!ok() && Date.now() < end) await sleep(30);
    };
    (window as unknown as { __reelnote: unknown }).__reelnote = {
      prepareCapture: async (o: { composition: string; frame: number; marks: Mark[] | null }) => {
        const c = ctl.current;
        const target = c.comps.find((x) => x.id === o.composition);
        if (!target) throw new Error(`No composition called "${o.composition}". Have: ${c.comps.map((x) => x.id).join(", ")}`);
        if (o.frame < 0 || o.frame >= target.durationInFrames) throw new Error(`${o.composition} has frames 0–${target.durationInFrames - 1}.`);
        saved ??= { compId: c.compId, frame: c.frame, playing: c.playing };
        c.player?.pause();
        setCapture({ marks: o.marks });
        if (c.compId !== o.composition) {
          c.switchComp(o.composition, o.frame);
          await waitFor(() => ctl.current.compId === o.composition && !!ctl.current.player);
          await frames2();
        }
        ctl.current.seek(o.frame);
        await frames2();
        // let images, videos and fonts settle
        await waitFor(() => {
          const root = frameRef.current;
          if (!root || buffering.current) return false;
          const imgs = Array.from(root.querySelectorAll("img")).every((i) => i.complete);
          const vids = Array.from(root.querySelectorAll("video")).every((v) => v.readyState >= 2 && !v.seeking);
          return imgs && vids;
        }, 6000);
        await document.fonts.ready;
        await frames2();
        await sleep(60);
        const r = frameRef.current!.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height, compWidth: target.width };
      },
      finishCapture: async () => {
        setCapture(null);
        const s = saved;
        saved = null;
        if (!s) return;
        const c = ctl.current;
        if (s.compId !== c.compId) {
          c.switchComp(s.compId, s.frame);
          await waitFor(() => ctl.current.compId === s.compId && !!ctl.current.player);
          await frames2();
        }
        ctl.current.seek(s.frame);
        if (s.playing) ctl.current.player?.play();
      },
    };
  }, []);

  // ---------- derived ----------
  const busy = !!job && ACTIVE.includes(job.status);
  const wave = waves[compId] ?? null;
  const waveBusy = (busy && job?.kind === "waveform" && job.composition === compId) || rq.queue.some((q) => q.kind === "waveform" && q.composition === compId);
  const timelineIssues: Issue[] = useMemo(() => {
    const lastRender = rq.history.find((r) => r.composition === compId && r.kind === "video" && r.status === "done" && !r.settings.range);
    return [...(lastRender?.video?.issues ?? []), ...(lastRender?.audio?.issues ?? wave?.issues ?? [])].filter((i) => i.kind !== "no-audio");
  }, [rq.history, compId, wave]);
  const marksHere = compNotes.filter((n) => n.kind === "visual" && n.frame === frame && n.marks.length && (n.status === "open" || n.id === selected));
  const stroke = comp ? Math.max(3, Math.min(comp.width, comp.height) / 160) : 4;
  const tc = (f: number) => {
    if (!comp) return "0:00.00";
    const s = f / comp.fps, m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
  };
  const folders = Array.from(new Set(comps.map((c) => c.folder ?? "")));

  return (
    <LangContext.Provider value={t}>
      <div className={`app${capture ? " capturing" : ""}`}>
        <header className="top">
          <div className="brand"><svg viewBox="0 0 64 64" width="22" height="22"><circle cx="32" cy="32" r="20" fill="none" stroke={MARK_COLOR} strokeWidth="7" /></svg>ReelNote</div>
          <span className="project">{boot.project}</span>
          <select className="comp-select" value={compId} onChange={(e) => switchComp(e.target.value)} title={t.compositions}>
            {folders.map((f) => {
              const items = comps.filter((c) => (c.folder ?? "") === f).map((c) => (
                <option key={c.id} value={c.id}>{c.id} · {c.width}×{c.height} · {c.still ? "still" : `${(c.durationInFrames / c.fps).toFixed(1)}s`}</option>
              ));
              return f ? <optgroup key={f} label={f}>{items}</optgroup> : items;
            })}
          </select>
          <div className="spacer" />
          <MemBar m={mem} />
          <div className="seg small">
            {(["en", "bn"] as Lang[]).map((l) => (
              <button key={l} className={settings.lang === l ? "on" : ""} onClick={() => saveSettings({ ...settings, lang: l })}>{l === "en" ? "EN" : "বাং"}</button>
            ))}
          </div>
          <button className="icon" onClick={() => setHelp(true)} title={t.k_help}>?</button>
        </header>

        <main className="main">
          <section className="center">
            {draft && (
              <div className="drawbar">
                {draft.kind === "visual" ? (
                  <>
                    {TOOLS.map((tool, i) => (
                      <button key={tool} className={draft.tool === tool ? "on" : ""} title={`${t[`tools_${tool}`]} (${i + 1})`}
                        onClick={() => { setLastTool(tool); setDraft({ ...draft, tool }); }}>
                        <span className="ti">{TOOL_ICON[tool]}</span> {t[`tools_${tool}`]}
                      </button>
                    ))}
                    <button disabled={!draft.marks.length} onClick={() => setDraft({ ...draft, marks: draft.marks.slice(0, -1) })}>↶ {t.undo}</button>
                    <span className="hint">{t.drawHint}</span>
                  </>
                ) : <span className="hint">♪ {t.soundHint}</span>}
              </div>
            )}
            <div className="stage" ref={stageRef}>
              {!comp && <p className="empty big">{t.noComps}</p>}
              {comp && (
                <div className="frame" ref={frameRef} style={{ width: comp.width * scale, height: comp.height * scale }}>
                  <Player
                    key={comp.id}
                    ref={setPlayer}
                    {...(comp.lazyComponent ? { lazyComponent: comp.lazyComponent } : { component: comp.component! })}
                    inputProps={comp.props}
                    durationInFrames={comp.durationInFrames}
                    fps={comp.fps}
                    compositionWidth={comp.width}
                    compositionHeight={comp.height}
                    initialFrame={Math.min(frame, comp.durationInFrames - 1)}
                    style={{ width: "100%", height: "100%" }}
                    controls={false}
                    clickToPlay={false}
                    doubleClickToFullscreen={false}
                    spaceKeyToPlayOrPause={false}
                    numberOfSharedAudioTags={48}
                    moveToBeginningWhenEnded={false}
                    acknowledgeRemotionLicense
                    errorFallback={({ error }: { error: Error }) => <div className="player-error"><b>{comp.id}</b><pre>{error.message}</pre></div>}
                  />
                  {compare && !capture && (compare.clean || compare.image) && (
                    <div className="compare">
                      <img src={fileUrl((showMarks ? compare.image : compare.clean) ?? compare.image!, compare.created)} style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }} alt="" />
                      <div className="divider" style={{ left: `${split * 100}%` }}
                        onPointerDown={(e) => (e.currentTarget as Element).setPointerCapture(e.pointerId)}
                        onPointerMove={(e) => {
                          if (!(e.buttons & 1)) return;
                          const r = frameRef.current!.getBoundingClientRect();
                          setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
                        }} />
                      <span className="lbl l">{t.before}</span><span className="lbl r">{t.now}</span>
                    </div>
                  )}
                  <svg className={`overlay${draft?.kind === "visual" ? " drawing" : ""}`} viewBox={`0 0 ${comp.width} ${comp.height}`}
                    onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={() => setDragBoth(null)}>
                    <ArrowDefs />
                    {capture ? (
                      capture.marks?.map((m, i) => <MarkShape key={i} mark={m} stroke={stroke} />)
                    ) : (
                      <>
                        {!draft && !compare && marksHere.map((n) => n.marks.map((m, i) => (
                          <MarkShape key={`${n.id}-${i}`} mark={m} stroke={stroke} color={n.status === "fixed" ? FIXED_COLOR : MARK_COLOR} label={i === 0 ? String(n.id) : undefined} />
                        )))}
                        {draft?.marks.map((m, i) => <MarkShape key={i} mark={m} stroke={stroke} />)}
                        {dragMark && <MarkShape mark={dragMark} stroke={stroke} />}
                      </>
                    )}
                  </svg>
                </div>
              )}
              {buildError && !capture && (
                <div className="build-error">
                  <b>{t.buildError}</b>
                  <pre>{buildError}</pre>
                  <button onClick={() => setBuildError(null)}>{t.close}</button>
                </div>
              )}
            </div>

            {draft && (
              <div className="composer">
                <textarea ref={textRef} value={draft.text} placeholder={draft.kind === "audio" ? t.soundHint : t.writeHint} disabled={draft.saving}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveNote();
                    }
                  }} />
                <div className="composer-side">
                  <span className="muted small">{range && range[1] > range[0] ? `${t.range} ${range[0]}–${range[1]}` : `${t.frame} ${range ? range[0] : frame}`} · {draft.marks.length} ✎</span>
                  <span className="muted small">{t.enterToSave}</span>
                  <div className="row">
                    <button onClick={() => setDraft(null)}>{t.cancel}</button>
                    <button className="primary" onClick={saveNote} disabled={draft.saving}>{draft.saving ? t.saving : t.save}</button>
                  </div>
                </div>
              </div>
            )}

            {compare && (
              <div className="comparebar">
                <b>#{compare.id}</b> <span className="muted">{noteRange(compare)}</span> <span className="ellipsis">{compare.text}</span>
                <label className="check"><input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} /> {t.showMarks}</label>
                <button onClick={() => setCompare(null)}>{t.close}</button>
              </div>
            )}

            {comp && (
              <div className="transport">
                <button className="icon" onClick={() => { player?.pause(); seek(frame - 1); }} title={t.back}>⏮</button>
                <button className="icon play" onClick={toggle} title={playing ? t.pause : t.play}>{playing ? "⏸" : "▶"}</button>
                <button className="icon" onClick={() => { player?.pause(); seek(frame + 1); }} title={t.fwd}>⏭</button>
                <span className="counter"><b>{frame}</b> / {last} <span className="muted">· {tc(frame)}</span></span>
                <div className="spacer" />
                <button onClick={() => setRange((r) => [frame, r && r[1] >= frame ? r[1] : frame])} title={t.setIn}>[ I</button>
                <button onClick={() => setRange((r) => [r && r[0] <= frame ? r[0] : frame, frame])} title={t.setOut}>O ]</button>
                {range && <span className="chip">{t.range} {range[0]}–{range[1]} <button className="x" onClick={() => setRange(null)} title={t.clearRange}>×</button></span>}
                <button onClick={() => startNote("audio")} title={`${t.soundNote} (A)`}>♪ {t.soundNote}</button>
                <button className="primary" onClick={() => startNote("visual")} title={`${t.addNote} (N)`}>◯ {t.addNote} <kbd>N</kbd></button>
              </div>
            )}
            {comp && (
              <Timeline duration={comp.durationInFrames} fps={comp.fps} frame={frame} notes={compNotes} selected={selected} range={range}
                peaks={wave?.peaks ?? null} issues={timelineIssues} waveBusy={waveBusy}
                onSeek={(f) => seek(f)} onScrub={(s) => s && player?.pause()} onRange={setRange}
                onPick={(id) => { const n = notes.find((x) => x.id === id); if (n) goNote(n); }}
                onWave={() => api("waveform", { body: { composition: compId } }).catch((e: Error) => toast(e.message))} />
            )}
            {comp && wave && (
              <div className="wave-meta muted small">
                ♪ {wave.hasAudio ? `${wave.rmsDb} dB avg · ${wave.peakDb} dB peak` : "—"}
                <button className="link" disabled={waveBusy} onClick={() => api("waveform", { body: { composition: compId } }).catch((e: Error) => toast(e.message))}>
                  {waveBusy ? t.waveformBuilding : t.waveformRefresh}
                </button>
              </div>
            )}
          </section>

          <aside className="side">
            <nav className="tabs">
              <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>{t.tabNotes} {openCount > 0 && <span className="count">{openCount}</span>}</button>
              <button className={tab === "render" ? "on" : ""} onClick={() => setTab("render")}>{t.tabRender} {busy && <span className="dot" />}</button>
              <button className={tab === "tools" ? "on" : ""} onClick={() => setTab("tools")}>{t.tabTools}</button>
            </nav>
            <div className="side-body">
              {tab === "notes" && <NotesPanel notes={notes} compId={compId} selected={selected} onGo={goNote} onCompare={openCompare} toast={toast} />}
              {tab === "render" && (
                <RenderPanel comp={comp} rq={rq} job={job} mem={mem} settings={settings.render} range={range}
                  onSettings={(r) => saveSettings({ ...settings, render: r })} onJump={(c, f) => { player?.pause(); switchComp(c, f); }} toast={toast} />
              )}
              {tab === "tools" && <ToolsPanel lang={settings.lang} toast={toast} busy={busy} />}
            </div>
            <div className="activity">
              <h5>✦ {t.claudeActivity}</h5>
              {!acts.length && <p className="muted small">{t.idle}</p>}
              {acts.map((a, i) => (
                <p key={`${a.at}-${i}`} className={i === acts.length - 1 ? "last" : ""}>
                  <span className="muted">{new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {a.text}
                </p>
              ))}
            </div>
          </aside>
        </main>

        {help && (
          <div className="modal" onClick={() => setHelp(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h3>{t.shortcuts}</h3>
              <KeyList />
              <button onClick={() => setHelp(false)}>{t.close}</button>
            </div>
          </div>
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </LangContext.Provider>
  );
};
