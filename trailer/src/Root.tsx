import React from "react";
import { Composition } from "remotion";
import { Trailer } from "./Trailer";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LangscapeTrailer"
      component={Trailer}
      durationInFrames={750}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
