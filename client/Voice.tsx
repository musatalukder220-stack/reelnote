// Voice typing for notes with the browser's own speech recognition (Chrome and Edge have it built in;
// it understands Bangla). Nothing to install. It does need the internet, because the browser sends the sound to its service.
import React, { useEffect, useRef, useState } from "react";
import { useT } from "./i18n";

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Recognition = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export const voiceSupported = !!Recognition;

export const VoiceButton: React.FC<{ uiLang: "en" | "bn"; onText: (s: string) => void; onInterim: (s: string) => void; toast: (s: string) => void; stopSignal: unknown }> = ({ uiLang, onText, onInterim, toast, stopSignal }) => {
  const t = useT();
  const [on, setOn] = useState(false);
  const [lang, setLang] = useState<"bn-BD" | "en-US">(uiLang === "bn" ? "bn-BD" : "en-US");
  const rec = useRef<Rec | null>(null);
  const stop = () => {
    rec.current?.stop();
    rec.current = null;
    setOn(false);
    onInterim("");
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (on) stop();
  }, [stopSignal]);
  if (!Recognition) return null;
  const start = () => {
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onText(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      onInterim(interim);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast(t.voiceDenied);
      else if (e.error === "network") toast(t.voiceNoNet);
      else if (e.error !== "no-speech" && e.error !== "aborted") toast(e.error);
    };
    r.onend = () => {
      setOn(false);
      onInterim("");
    };
    rec.current = r;
    try {
      r.start();
      setOn(true);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <span className="voice">
      <button className={on ? "rec" : ""} onClick={() => (on ? stop() : start())} title={t.voice}>{on ? `■ ${t.voiceStop}` : `🎙 ${t.voice}`}</button>
      <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} title={t.voiceLang} disabled={on}>
        <option value="bn-BD">বাংলা</option>
        <option value="en-US">English</option>
      </select>
    </span>
  );
};
