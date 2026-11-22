import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const Intro: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = spring({ frame, fps });
  const x = interpolate(frame, [0, 150], [0, width - 200]);
  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg,#1b2a6b,#6b1b5e)", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ color: "white", fontSize: 90, fontFamily: "sans-serif", transform: `scale(${s})` }}>{title}</h1>
      <div style={{ position: "absolute", left: x, top: 60, width: 120, height: 120, borderRadius: 60, background: "#ffc83d" }} />
      <Sequence from={10}><Html5Audio src={staticFile("tone.wav")} /></Sequence>
    </AbsoluteFill>
  );
};
