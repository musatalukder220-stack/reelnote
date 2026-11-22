// Boot: load the film's entry (it calls registerRoot), find its compositions, show the app.
import "./style.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { collectCompositions } from "./collect";

const root = createRoot(document.getElementById("root")!);
const Message: React.FC<{ title: string; text?: string; error?: boolean }> = ({ title, text, error }) => (
  <div className={`boot${error ? " error" : ""}`}>
    <svg viewBox="0 0 64 64" width="44" height="44"><circle cx="32" cy="32" r="20" fill="none" stroke="#ffd23f" strokeWidth="7" /></svg>
    <h2>{title}</h2>
    {text && <pre>{text}</pre>}
  </div>
);

root.render(<Message title="ReelNote" text="Loading your film…" />);

(async () => {
  try {
    await import("reelnote:entry");
    const comps = await collectCompositions();
    root.render(<App comps={comps} />);
  } catch (e) {
    const err = e as Error;
    root.render(<Message error title="Your film didn't load" text={`${err.message}\n\n${err.stack ?? ""}`} />);
  }
})();
