import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
// frame 40 is a black flash; frame 60 repeats frame 59 (stutter) while everything moves
export const Glitchy: React.FC = () => {
  let frame = useCurrentFrame();
  if (frame === 60) frame = 59;
  if (frame === 40) return <AbsoluteFill style={{ background: "black" }} />;
  return (
    <AbsoluteFill style={{ background: `hsl(${frame * 3}, 60%, 50%)` }}>
      <div style={{ position: "absolute", left: frame * 6, top: 100, width: 140, height: 140, background: "white" }} />
    </AbsoluteFill>
  );
};
