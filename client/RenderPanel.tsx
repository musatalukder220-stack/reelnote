// Render once: settings, queue, live progress with memory, finished renders with their frame and sound check.
import React from "react";
import { api } from "./api";
import { useT } from "./i18n";
import type { Comp, Issue, Job, Memory, RenderSettings, RenderState } from "./types";

const ACTIVE = ["queued", "bundling", "rendering", "encoding", "checking"];
const CODECS: [RenderSettings["codec"], string][] = [["h264", "MP4 · H.264"], ["h265", "MP4 · H.265"], ["vp9", "WebM · VP9"], ["prores", "MOV · ProRes"], ["gif", "GIF"]];

export const autoThreads = (m: Memory, cpus = navigator.hardwareConcurrency || 4) => {
  if (!m || m.pressure !== "normal") return 1;
  const byRam = m.totalGB <= 8.5 ? 1 : m.totalGB <= 16.5 ? 2 : m.totalGB <= 32.5 ? 4 : 6;
  return Math.max(1, Math.min(byRam, Math.max(1, Math.floor(m.availableMB / 1500)), Math.max(1, Math.floor(cpus / 2)), 8));
};

export const MemBar: React.FC<{ m: Memory }> = ({ m }) => {
  const t = useT();
  if (!m) return null;
  const used = Math.min(1, m.usedGB / m.totalGB);
  return (
    <div className={`mem ${m.pressure}`} title={`${t.memory}: ${m.usedGB.toFixed(1)} / ${m.totalGB.toFixed(0)} GB`}>
      <div className="mem-bar"><i style={{ width: `${used * 100}%` }} /></div>
      <span>{(m.availableMB / 1024).toFixed(1)} GB {t.memFree}{m.swapUsedGB !== null && m.swapUsedGB > 0.05 ? ` · ${t.swap} ${m.swapUsedGB.toFixed(1)} GB` : ""}
        {m.pressure !== "normal" ? ` · ${m.pressure === "critical" ? t.critical : t.warning}` : ""}</span>
    </div>
  );
};

const IssueChips: React.FC<{ issues: Issue[]; onJump: (f: number) => void }> = ({ issues, onJump }) => (
  <div className="issues">
    {issues.map((i, k) => (
      <button key={k} className={`issue ${i.level}`} title={i.message} onClick={() => onJump(i.frame)}>
        {i.level === "error" ? "✗" : i.level === "warning" ? "!" : "·"} {i.message}
      </button>
    ))}
  </div>
);

type Props = {
  comp: Comp | null; rq: RenderState; job: Job | null; mem: Memory; settings: RenderSettings; range: [number, number] | null;
  onSettings: (s: RenderSettings) => void; onJump: (comp: string, frame: number) => void; toast: (s: string) => void;
};

export const RenderPanel: React.FC<Props> = ({ comp, rq, job, mem, settings: s, range, onSettings, onJump, toast }) => {
  const t = useT();
  const set = (patch: Partial<RenderSettings>) => onSettings({ ...s, ...patch });
  const live = job && ACTIVE.includes(job.status) ? job : null;
  const act = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message));
  const useRange = !!s.range;
  const pct = live?.total ? (live.status === "checking" ? live.checked / live.total : live.status === "encoding" ? live.encoded / live.total : live.rendered / live.total) : 0;

  return (
    <div className="renderp">
      <div className="form">
        <label>{t.format}
          <select value={s.codec} onChange={(e) => set({ codec: e.target.value as RenderSettings["codec"] })}>
            {CODECS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>{t.size}
          <select value={s.scale} onChange={(e) => set({ scale: Number(e.target.value) })}>
            {[2, 1, 0.75, 0.5, 0.25].map((v) => <option key={v} value={v}>{v * 100}%{comp ? ` · ${Math.round(comp.width * v)}×${Math.round(comp.height * v)}` : ""}</option>)}
          </select>
        </label>
        <label>{t.quality}
          <select value={s.crf ?? ""} disabled={s.codec === "gif" || s.codec === "prores"} onChange={(e) => set({ crf: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">{t.qualityDefault}</option>
            <option value={16}>{t.qualityHigh} (CRF 16)</option>
            <option value={23}>{t.qualityMed} (CRF 23)</option>
            <option value={30}>{t.qualitySmall} (CRF 30)</option>
          </select>
        </label>
        <label>{t.threads}
          <select value={String(s.concurrency)} onChange={(e) => set({ concurrency: e.target.value === "auto" ? "auto" : Number(e.target.value) })}>
            <option value="auto">{t.threadsAuto(autoThreads(mem))}</option>
            {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>{t.range}
          <select value={useRange ? "range" : "whole"} onChange={(e) => set({ range: e.target.value === "range" && range ? range : null })}>
            <option value="whole">{t.whole}</option>
            <option value="range" disabled={!range}>{t.selected}{range ? ` · ${range[0]}–${range[1]}` : " (I / O)"}</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={s.muted} onChange={(e) => set({ muted: e.target.checked })} /> {t.muted}</label>
      </div>
      <p className="hint">{t.safeNote}</p>
      <button className="primary big" disabled={!comp}
        onClick={() => comp && act(api("render", { body: { composition: comp.id, settings: { ...s, range: s.range && range ? range : null } } }))}>
        ▶ {t.renderThis}{comp ? ` · ${comp.id}` : ""}
      </button>

      {live && (
        <div className="job">
          <div className="job-head">
            <b>{live.kind === "waveform" ? `♪ ${t.soundOf} · ` : ""}{live.composition}</b>
            <span>{t[`st_${live.status}` as "st_done"]}{live.total ? ` · ${live.status === "checking" ? live.checked : live.status === "encoding" ? live.encoded : live.rendered}/${live.total}` : ""}{live.eta ? ` · ${live.eta} ${t.left}` : ""}</span>
            <button onClick={() => act(api("render/cancel", { body: {} }))}>{t.cancel}</button>
          </div>
          <div className="progress"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <div className="job-meta">{live.concurrency} {t.threads.toLowerCase()} · {live.out}</div>
          <MemBar m={live.memory ?? mem} />
          {live.log.length > 0 && <pre className="log">{live.log.slice(-4).join("\n")}</pre>}
        </div>
      )}
      {rq.waiting && <p className="hint warn">{rq.waiting}</p>}
      {rq.queue.length > 0 && (
        <div className="queue">
          <h4>{t.queue}</h4>
          {rq.queue.map((q) => (
            <span key={q.id} className="qchip">{q.kind === "waveform" ? "♪ " : ""}{q.composition}
              <button onClick={() => act(api(`render/queue/${q.id}`, { method: "DELETE" }))}>×</button></span>
          ))}
        </div>
      )}

      <h4>{t.finished}</h4>
      {!rq.history.length && <p className="empty">{t.noRenders}</p>}
      {rq.history.map((r) => {
        const issues = [...(r.video?.issues ?? []), ...(r.audio?.issues ?? [])];
        const bad = issues.filter((i) => i.level !== "info").length;
        return (
          <div key={r.id} className={`rrow ${r.status}`}>
            <div className="rrow-head">
              <b>{r.kind === "waveform" ? `♪ ${r.composition}` : r.composition}</b>
              <span className="muted">{r.status === "done" ? `${(r.sizeMB ?? 0) < 1 ? `${Math.round((r.sizeMB ?? 0) * 1024)} KB` : `${r.sizeMB?.toFixed(1)} MB`} · ${(r.minutes ?? 0).toFixed(1)} min · ${r.concurrency}×` : t[`st_${r.status}` as "st_done"]}</span>
              {r.status === "done" && r.kind === "video" && <span className={`badge ${bad ? "bad" : "fixed"}`}>{bad ? t.problems(bad) : `✓ ${t.noProblems}`}</span>}
              {r.status === "done" && <button onClick={() => act(api("reveal", { body: { path: r.out } }))}>{t.show}</button>}
            </div>
            {r.status === "failed" && r.error && <pre className="log err">{r.error}</pre>}
            {r.audio?.hasAudio && r.kind === "video" && <div className="muted small">♪ {r.audio.rmsDb} dB avg · {r.audio.peakDb} dB peak</div>}
            {issues.length > 0 && <IssueChips issues={issues} onJump={(f) => onJump(r.composition, f + (r.settings.range?.[0] ?? 0))} />}
          </div>
        );
      })}
    </div>
  );
};
