// The list of notes: filter, jump to a note, before/now, filmstrips, reply, mark fixed, Claude's changes (and undo),
// delete, and "Send to Claude". Reviewers on a share link see a simpler version: read, write, reply.
import React, { useState } from "react";
import { api, fileUrl, isReviewer, saveName } from "./api";
import { useT } from "./i18n";
import { LiveThumb } from "./LiveThumb";
import type { Comp, Note } from "./types";

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

const Changes: React.FC<{ note: Note; onClose: () => void; toast: (s: string) => void }> = ({ note, onClose, toast }) => {
  const t = useT();
  const [data, setData] = useState<{ files: { path: string; added: number; removed: number }[]; patch: string; undone: boolean } | null>(null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  React.useEffect(() => {
    api<typeof data>(`notes/${note.id}/changes`).then(setData).catch((e: Error) => setErr(e.message));
  }, [note.id]);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box wide" onClick={(e) => e.stopPropagation()}>
        <h3>#{note.id} · {t.changes}</h3>
        {err && <p className="bad">{err}</p>}
        {data && (
          <>
            {!data.files.length && <p className="empty">{t.noChange}</p>}
            <ul className="files">{data.files.map((f) => <li key={f.path}><code>{f.path}</code> <span className="add">+{f.added}</span> <span className="del">−{f.removed}</span></li>)}</ul>
            <pre className="diff">{data.patch.split("\n").map((l, i) => (
              <span key={i} className={l.startsWith("+++") || l.startsWith("---") ? "fh" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l}{"\n"}</span>
            ))}</pre>
          </>
        )}
        <div className="row">
          {data && !data.undone && data.files.length > 0 && !isReviewer && (
            <button className={sure ? "danger" : ""} onClick={async () => {
              if (!sure) return setSure(true);
              try {
                await api(`notes/${note.id}/undo`, { body: {} });
                toast(t.undone);
                onClose();
              } catch (e) {
                setErr((e as Error).message);
                setSure(false);
              }
            }}>{sure ? t.undoSure : `↶ ${t.undoFix}`}</button>
          )}
          {data?.undone && <span className="muted">{t.undone}</span>}
          <div className="spacer" />
          <button onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
};

type Props = {
  notes: Note[]; comps: Comp[]; compId: string; selected: number | null;
  onGo: (n: Note) => void; onCompare: (n: Note) => void; toast: (s: string) => void;
  name: string; onName: (s: string) => void;
};

export const NotesPanel: React.FC<Props> = ({ notes, comps, compId, selected, onGo, onCompare, toast, name, onName }) => {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "open" | "fixed">("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Record<number, string>>({});
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [changes, setChanges] = useState<Note | null>(null);
  const open = notes.filter((n) => n.status === "open").length;
  const list = notes.filter((n) => filter === "all" || n.status === filter).slice().sort((a, b) => (a.composition === b.composition ? a.frame - b.frame : a.composition.localeCompare(b.composition)));

  const act = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message));
  const sendReply = (n: Note, reopen: boolean) => {
    const text = (reply[n.id] ?? "").trim();
    if (!text) return;
    act(api(`notes/${n.id}/replies`, { body: { text, reopen, author: name } }).then(() => setReply((r) => ({ ...r, [n.id]: "" }))));
  };

  return (
    <div className="notes">
      {isReviewer && (
        <label className="name-field">{t.yourName}
          <input value={name} placeholder={t.namePh} onChange={(e) => { onName(e.target.value); saveName(e.target.value); }} />
        </label>
      )}
      <div className="notes-top">
        <div className="seg">
          {(["all", "open", "fixed"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {t[f]} <span>{f === "all" ? notes.length : f === "open" ? open : notes.length - open}</span>
            </button>
          ))}
        </div>
        {!isReviewer && <button className="primary" disabled={!open} onClick={async () => toast((await copyText(t.claudeMsg(open))) ? t.copied : t.copyFailed)}>✦ {t.sendClaude}</button>}
      </div>
      {!list.length && <p className="empty">{t.noNotes}</p>}
      {list.map((n) => {
        const comp = comps.find((c) => c.id === n.composition);
        const showNow = n.kind === "visual" && comp && n.image;
        return (
          <div key={n.id} className={`card ${n.status}${selected === n.id ? " sel" : ""}`} onClick={() => onGo(n)}>
            <div className="card-head">
              <b>#{n.id}</b>
              {n.composition !== compId && <span className="chip">{n.composition}</span>}
              <span className="muted">{noteRange(n)}</span>
              {n.kind === "audio" && <span className="chip sound">♪ {t.sound}</span>}
              {n.author && <span className="chip who">{t.by} {n.author}</span>}
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
            {showNow ? (
              <div className="before-now">
                <figure><img src={fileUrl(n.image!, n.created)} alt="" loading="lazy" /><figcaption>{t.before}</figcaption></figure>
                <figure><LiveThumb comp={comp!} frame={n.frame} marks={n.marks} /><figcaption>{t.now}</figcaption></figure>
              </div>
            ) : n.image ? <img className="thumb" src={fileUrl(n.image, n.created)} alt="" loading="lazy" /> : null}
            {n.strip && (
              <details className="strip" onClick={(e) => e.stopPropagation()}>
                <summary>{t.strip}</summary>
                <img src={fileUrl(n.strip, n.created)} alt="" loading="lazy" />
              </details>
            )}
            {n.props && <p className="muted small">props: {JSON.stringify(n.props).slice(0, 120)}</p>}
            {n.replies.length > 0 && (
              <div className="thread">
                {n.replies.map((r, i) => (
                  <p key={i} className={r.by}><b>{r.by === "claude" ? `✦ ${t.claude}` : r.name ?? t.you}</b> {r.text}</p>
                ))}
              </div>
            )}
            {selected === n.id && (
              <div className="reply" onClick={(e) => e.stopPropagation()}>
                <input value={reply[n.id] ?? ""} placeholder={t.replyPh} onChange={(e) => setReply((r) => ({ ...r, [n.id]: e.target.value }))}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") sendReply(n, false); }} />
                <button onClick={() => sendReply(n, false)}>{t.reply}</button>
                {n.status === "fixed" && !isReviewer && <button onClick={() => sendReply(n, true)}>{t.replyReopen}</button>}
              </div>
            )}
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onGo(n)}>{t.goTo}</button>
              {n.kind === "visual" && n.clean && <button onClick={() => onCompare(n)}>{t.compare}</button>}
              {n.fix && !isReviewer && (
                <button onClick={() => setChanges(n)} className={n.fix.undone ? "muted" : ""}>
                  {t.changes} {n.fix.files.length ? `(${t.filesChanged(n.fix.files.length)}, +${n.fix.files.reduce((a, f) => a + f.added, 0)} −${n.fix.files.reduce((a, f) => a + f.removed, 0)})` : ""}{n.fix.undone ? ` · ${t.undone}` : ""}
                </button>
              )}
              {!isReviewer && (
                <>
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
                </>
              )}
            </div>
          </div>
        );
      })}
      {changes && <Changes note={changes} onClose={() => setChanges(null)} toast={toast} />}
    </div>
  );
};

