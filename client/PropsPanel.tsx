// Try different props without touching code. Changes are saved next to the notes, used by the preview,
// by frame pictures (and so by Claude) and by renders.
import React, { useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Comp } from "./types";

const isColor = (v: unknown) => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const JsonField: React.FC<{ value: unknown; onChange: (v: unknown) => void }> = ({ value, onChange }) => {
  const t = useT();
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [JSON.stringify(value)]);
  return (
    <>
      <textarea className={`json${bad ? " bad" : ""}`} value={text} rows={Math.min(10, text.split("\n").length + 1)}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }} />
      {bad && <span className="small bad">{t.badJson}</span>}
    </>
  );
};

export const PropsPanel: React.FC<{ comp: Comp | null; override: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }> = ({ comp, override, onChange }) => {
  const t = useT();
  if (!comp) return null;
  const keys = Object.keys(comp.defaults);
  if (!keys.length) return <p className="empty">{t.noProps}</p>;
  const set = (k: string, v: unknown) => {
    const next = { ...override };
    if (same(v, comp.defaults[k])) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <div className="propsp">
      <p className="hint">{t.propsHint}</p>
      {keys.map((k) => {
        const def = comp.defaults[k];
        const v = k in override ? override[k] : def;
        const changed = k in override;
        return (
          <label key={k} className={`prop${changed ? " changed" : ""}`}>
            <span className="prop-name">{k}{changed && <em> · {t.changed} <button className="link" onClick={(e) => { e.preventDefault(); set(k, def); }}>↺</button></em>}</span>
            {typeof def === "boolean" ? (
              <input type="checkbox" checked={!!v} onChange={(e) => set(k, e.target.checked)} />
            ) : typeof def === "number" ? (
              <input type="number" value={Number(v)} step="any" onChange={(e) => e.target.value !== "" && set(k, Number(e.target.value))} />
            ) : isColor(def) ? (
              <span className="row"><input type="color" value={String(v).slice(0, 7)} onChange={(e) => set(k, e.target.value)} /><input value={String(v)} onChange={(e) => set(k, e.target.value)} /></span>
            ) : typeof def === "string" ? (
              String(def).length > 60 ? <textarea value={String(v)} onChange={(e) => set(k, e.target.value)} /> : <input value={String(v)} onChange={(e) => set(k, e.target.value)} />
            ) : (
              <JsonField value={v} onChange={(x) => set(k, x)} />
            )}
          </label>
        );
      })}
      <button disabled={!Object.keys(override).length} onClick={() => onChange({})}>{t.resetProps}</button>
    </div>
  );
};
