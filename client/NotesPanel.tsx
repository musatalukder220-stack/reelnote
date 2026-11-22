// The list of notes: filter, jump to a note, before/after, reply, mark fixed, delete, and "Send to Claude".
import React, { useState } from "react";
import { api, fileUrl } from "./api";
import { useT } from "./i18n";
import type { Note } from "./types";

const tc = (f: number, fps: number) => {
  const s = f / fps, m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};
export const noteRange = (n: Note) =>
  n.endFrame !== null ? `${n.frame}–${n.endFrame} · ${tc(n.frame, n.fps)}–${tc(n.endFrame, n.fps)}` : `${n.frame} · ${tc(n.frame, n.fps)}`;

export const copyText = async (s: string) => {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
};

type Props = {
  notes: Note[]; compId: string; selected: number | null;
  onGo: (n: Note) => void; onCompare: (n: Note) => void; toast: (s: string) => void;
};

export const NotesPanel: React.FC<Props> = ({ notes, compId, selected, onGo, onCompare, toast }) => {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "open" | "fixed">("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Record<number, string>>({});
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const open = notes.filter((n) => n.status === "open").length;
  const list = notes.filter((n) => filter === "all" || n.status === filter).slice().sort((a, b) => (a.composition === b.composition ? a.frame - b.frame : a.composition.localeCompare(b.composition)));

  const act = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message));
  const sendReply = (n: Note, reopen: boolean) => {
    const text = (reply[n.id] ?? "").trim();
    if (!text) return;
    act(api(`notes/${n.id}/replies`, { body: { text, reopen } }).then(() => setReply((r) => ({ ...r, [n.id]: "" }))));
  };

  return (
    <div className="notes">
      <div className="notes-top">
        <div className="seg">
          {(["all", "open", "fixed"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {t[f]} <span>{f === "all" ? notes.length : f === "open" ? open : notes.length - open}</span>
            </button>
          ))}
        </div>
        <button className="primary" disabled={!open} onClick={async () => toast((await copyText(t.claudeMsg(open))) ? t.copied : t.copyFailed)}>✦ {t.sendClaude}</button>
      </div>
      {!list.length && <p className="empty">{t.noNotes}</p>}
      {list.map((n) => (
        <div key={n.id} className={`card ${n.status}${selected === n.id ? " sel" : ""}`} onClick={() => onGo(n)}>
          <div className="card-head">
            <b>#{n.id}</b>
            {n.composition !== compId && <span className="chip">{n.composition}</span>}
            <span className="muted">{noteRange(n)}</span>
            {n.kind === "audio" && <span className="chip sound">♪ {t.sound}</span>}
            <span className={`badge ${n.status}`}>{n.status === "fixed" ? `✓ ${t.fixed}` : t.open}</span>
          </div>
          {editing === n.id ? (
            <textarea className="edit" autoFocus value={draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  act(api(`notes/${n.id}`, { method: "PATCH", body: { text: draft } }));
                  setEditing(null);
                }
                if (e.key === "Escape") setEditing(null);
              }} />
          ) : (
            <p className="card-text">{n.text || <i className="muted">—</i>}</p>
          )}
          {n.image && <img className="thumb" src={fileUrl(n.image, n.created)} alt="" loading="lazy" />}
          {n.replies.length > 0 && (
            <div className="thread">
              {n.replies.map((r, i) => (
                <p key={i} className={r.by}><b>{r.by === "claude" ? `✦ ${t.claude}` : t.you}</b> {r.text}</p>
              ))}
            </div>
          )}
          {selected === n.id && (
            <div className="reply" onClick={(e) => e.stopPropagation()}>
              <input value={reply[n.id] ?? ""} placeholder={t.replyPh} onChange={(e) => setReply((r) => ({ ...r, [n.id]: e.target.value }))}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") sendReply(n, false); }} />
              <button onClick={() => sendReply(n, false)}>{t.reply}</button>
              {n.status === "fixed" && <button onClick={() => sendReply(n, true)}>{t.replyReopen}</button>}
            </div>
          )}
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onGo(n)}>{t.goTo}</button>
            {n.kind === "visual" && n.clean && <button onClick={() => onCompare(n)}>{t.compare}</button>}
            <button onClick={() => act(api(`notes/${n.id}`, { method: "PATCH", body: { status: n.status === "fixed" ? "open" : "fixed" } }))}>
              {n.status === "fixed" ? t.reopen : t.markFixed}
            </button>
            <button onClick={() => { setEditing(n.id); setDraft(n.text); }}>{t.edit}</button>
            <button className={confirmDel === n.id ? "danger" : ""}
              onClick={() => {
                if (confirmDel === n.id) {
                  act(api(`notes/${n.id}`, { method: "DELETE" }));
                  setConfirmDel(null);
                } else {
                  setConfirmDel(n.id);
                  setTimeout(() => setConfirmDel((c) => (c === n.id ? null : c)), 3000);
                }
              }}>
              {confirmDel === n.id ? t.delSure : t.del}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
