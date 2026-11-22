import React from "react";
import { Composition, Folder, Still } from "remotion";
import { Intro } from "./Intro";
import { Glitchy } from "./Glitchy";

export const Root: React.FC = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={150} fps={30} width={1280} height={720} defaultProps={{ title: "Hello ReelNote" }} />
    <Folder name="Tests">
      <Composition id="Glitchy" component={Glitchy} durationInFrames={90} fps={30} width={640} height={360} />
      <Composition id="Vertical" component={Intro} durationInFrames={60} fps={30} width={540} height={960}
        defaultProps={{ title: "Tall" }} calculateMetadata={async ({ props }) => ({ durationInFrames: 75, props })} />
    </Folder>
    <Still id="Poster" component={Intro} width={800} height={800} defaultProps={{ title: "Poster" }} />
  </>
);
