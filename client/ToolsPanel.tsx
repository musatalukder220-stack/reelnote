// Report export, clean-up of temporary files, keys and version.
import React, { useEffect, useState } from "react";
import { api, boot } from "./api";
import { useT, type Lang } from "./i18n";

const gb = (b: number) => (b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(0)} MB`);

export const KEYS: [string, keyof ReturnType<typeof useT>][] = [
  ["Space", "k_play"], ["← →", "k_step"], ["Shift + ← →", "k_step10"], ["Home / End", "k_home"], ["N", "k_note"], ["A", "k_sound"],
  ["I / O", "k_io"], ["X", "k_x"], ["1 2 3 4", "k_tools"], ["[ ]", "k_prev"], ["?", "k_help"], ["Esc", "k_esc"],
];

export const KeyList: React.FC = () => {
  const t = useT();
  return (
    <table className="keys"><tbody>
      {KEYS.map(([k, label]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{t[label] as string}</td></tr>)}
    </tbody></table>
  );
};

export const ToolsPanel: React.FC<{ lang: Lang; toast: (s: string) => void; busy: boolean }> = ({ lang, toast, busy }) => {
  const t = useT();
  const [format, setFormat] = useState<"md" | "html" | "pdf">("pdf");
  const [rlang, setRlang] = useState<Lang>(lang);
  const [which, setWhich] = useState<"all" | "open">("all");
  const [made, setMade] = useState<{ file: string; url: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [tmp, setTmp] = useState<{ bytes: number; count: number } | null>(null);
  const refresh = () => api<{ bytes: number; count: number }>("cleanup").then(setTmp).catch(() => {});
  useEffect(() => {
    refresh();
  }, [busy]);

  return (
    <div className="toolsp">
      <h4>{t.exportReport}</h4>
      <div className="form">
        <label>{t.format}
          <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            <option value="pdf">PDF</option><option value="html">HTML</option><option value="md">Markdown</option>
          </select>
        </label>
        <label>{t.lang}
          <select value={rlang} onChange={(e) => setRlang(e.target.value as Lang)}>
            <option value="en">English</option><option value="bn">বাংলা</option>
          </select>
        </label>
        <label>{t.whichNotes}
          <select value={which} onChange={(e) => setWhich(e.target.value as typeof which)}>
            <option value="all">{t.all}</option><option value="open">{t.open}</option>
          </select>
        </label>
      </div>
      <button className="primary" disabled={working} onClick={async () => {
        setWorking(true);
        try {
          setMade(await api("report", { body: { format, lang: rlang, status: which } }));
          toast(t.reportDone);
        } catch (e) {
          toast((e as Error).message);
        }
        setWorking(false);
      }}>{working ? "…" : t.exportReport}</button>
      {made && (
        <p className="made">
          <code>{made.file}</code>
          <span>
            {format !== "md" && <a href={made.url} target="_blank" rel="noreferrer">{t.openFile}</a>}
            <button onClick={() => api("reveal", { body: { path: made.file } }).catch((e: Error) => toast(e.message))}>{t.show}</button>
          </span>
        </p>
      )}

      <h4>{t.cleanup}</h4>
      {tmp && tmp.bytes > 0 ? (
        <div className="cleanrow">
          <span>{t.tempFiles}: <b>{gb(tmp.bytes)}</b> ({tmp.count})</span>
          <button disabled={busy} onClick={async () => {
            try {
              const r = await api<{ freed: number }>("cleanup", { body: {} });
              toast(`${t.freed} ${gb(r.freed)}`);
            } catch (e) {
              toast((e as Error).message);
            }
            refresh();
          }}>{t.cleanNow}</button>
        </div>
      ) : <p className="empty">{t.nothingToClean}</p>}

      <h4>{t.shortcuts}</h4>
      <KeyList />
      <h4>{t.about}</h4>
      <p className="muted small">ReelNote {boot.version} · MIT</p>
    </div>
  );
};
