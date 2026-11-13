import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const ACCENT = "#24F5B8";
const ACCENT_SOFT = "#8DFF82";
const BG = "#020705";
const INK = "#EDF9F3";
const MUTED = "#73978C";
const MONO = "'Noto Sans Mono', monospace";
const SANS = "'Noto Sans', sans-serif";
const GOTHIC = "'Langscape Gothic', 'Noto Sans', serif";

const TIMING = {
  intro: { from: 0, duration: 120 },
  fonts: { from: 120, duration: 135 },
  lexurgy: { from: 255, duration: 105 },
  canvas: { from: 360, duration: 105 },
  trees: { from: 465, duration: 135 },
  bases: { from: 600, duration: 75 },
  outro: { from: 675, duration: 75 },
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const easeOut = Easing.out(Easing.cubic);

const enter = (frame: number, delay = 0, stiffness = 110, damping = 18) =>
  spring({
    frame: frame - delay,
    fps: 30,
    config: { stiffness, damping, mass: 0.9 },
  });

const FontLoader: React.FC = () => {
  const [handle] = useState(() => delayRender("Loading Langscape Gothic"));
  useEffect(() => {
    document.fonts
      .load('40px "Langscape Gothic"')
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
  return null;
};

const GlobalStyle: React.FC = () => (
  <style>{`
    @font-face {
      font-family: 'Langscape Gothic';
      src: url('${staticFile("NotoSansGothic-Regular.ttf")}') format('truetype');
      font-display: block;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: ${BG}; }
  `}</style>
);

const SceneFade: React.FC<{
  duration: number;
  children: React.ReactNode;
  fadeIn?: number;
  fadeOut?: number;
}> = ({ duration, children, fadeIn = 10, fadeOut = 10 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, fadeIn, Math.max(fadeIn + 1, duration - fadeOut), duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Rise: React.FC<{
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  distance?: number;
}> = ({ delay = 0, children, style, distance = 34 }) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay);
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${(1 - p) * distance}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Kicker: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, 4);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: ACCENT,
        fontFamily: MONO,
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: 3.4,
        textTransform: "uppercase",
        opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        ...style,
      }}
    >
      <span
        style={{
          display: "block",
          width: 26,
          height: 2,
          background: ACCENT,
          boxShadow: `0 0 12px ${ACCENT}88`,
        }}
      />
      {children}
    </div>
  );
};

const Headline: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 8, size = 82, style }) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 90, 20);
  return (
    <div
      style={{
        color: INK,
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: -2.5,
        opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${(1 - p) * 46}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const AccentText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: ACCENT }}>{children}</span>
);

const Body: React.FC<{
  children: React.ReactNode;
  delay?: number;
  width?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 22, width = 520, style }) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 90, 20);
  return (
    <div
      style={{
        width,
        color: MUTED,
        fontFamily: SANS,
        fontSize: 24,
        lineHeight: 1.5,
        fontWeight: 400,
        opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${(1 - p) * 22}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 32,
      padding: "0 12px",
      border: "1px solid rgba(36,245,184,0.22)",
      borderRadius: 6,
      background: "rgba(36,245,184,0.045)",
      color: "#B9E8D9",
      fontFamily: MONO,
      fontSize: 13,
      letterSpacing: 0.4,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [0, 28]);
  const glow = interpolate(frame, [0, durationInFrames], [-2, 4]);
  const particles = Array.from({ length: 22 }, (_, i) => {
    const x = random(`particle-x-${i}`) * 100;
    const y = random(`particle-y-${i}`) * 100;
    const size = 1 + random(`particle-size-${i}`) * 1.8;
    const speed = 0.25 + random(`particle-speed-${i}`) * 0.8;
    const opacity = 0.08 + random(`particle-opacity-${i}`) * 0.25;
    return (
      <span
        key={i}
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `calc(${y}% - ${(frame * speed) % 80}px)`,
          width: size,
          height: size,
          borderRadius: "50%",
          background: ACCENT,
          opacity,
          boxShadow: `0 0 8px ${ACCENT}55`,
        }}
      />
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 74% 18%, rgba(36,245,184,0.12), transparent 40%), radial-gradient(circle at 14% 88%, rgba(16,105,86,0.16), transparent 38%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -40,
          backgroundImage:
            "radial-gradient(circle, rgba(184,255,235,0.16) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          opacity: 0.13,
          transform: `translate(${drift}px, ${drift * 0.5}px)`,
          maskImage: "linear-gradient(to bottom, black, transparent 82%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 980,
          height: 980,
          left: 1030,
          top: -330,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}22, transparent 64%)`,
          filter: "blur(45px)",
          transform: `translateY(${glow * 16}px) scale(${1 + glow * 0.012})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 740,
          height: 740,
          left: -330,
          bottom: -360,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(12,140,111,0.22), transparent 66%)",
          filter: "blur(55px)",
        }}
      />
      <svg
        style={{ position: "absolute", inset: 0, opacity: 0.22 }}
        width="1920"
        height="1080"
        viewBox="0 0 1920 1080"
        fill="none"
      >
        <circle
          cx="1515"
          cy="260"
          r="248"
          stroke={ACCENT}
          strokeOpacity="0.16"
          strokeDasharray="1 11"
          transform={`rotate(${frame * 0.05} 1515 260)`}
        />
        <circle cx="1515" cy="260" r="332" stroke={ACCENT} strokeOpacity="0.06" />
        <path d="M1180 900 L1920 600" stroke={ACCENT} strokeOpacity="0.08" />
        <path d="M1240 980 L1920 710" stroke={ACCENT} strokeOpacity="0.045" />
      </svg>
      <div style={{ position: "absolute", inset: 0 }}>{particles}</div>
      <Img
        src={staticFile("noise.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.055,
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.52) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(2,7,5,0.12), transparent 22%, transparent 76%, rgba(2,7,5,0.55))",
        }}
      />
    </AbsoluteFill>
  );
};

const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / (durationInFrames - 1);
  const time = Math.floor(frame / 30);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 58,
          top: 44,
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "#C9E9DD",
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: 3,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            border: `1px solid ${ACCENT}88`,
            display: "grid",
            placeItems: "center",
            color: ACCENT,
            fontSize: 12,
          }}
        >
          L
        </span>
        LANGSCAPE
      </div>
      <div
        style={{
          position: "absolute",
          right: 58,
          top: 48,
          color: "rgba(201,233,221,0.44)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 2.4,
        }}
      >
        OBSIDIAN / 2026
      </div>
      <div
        style={{
          position: "absolute",
          left: 58,
          bottom: 40,
          color: "rgba(201,233,221,0.38)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 1.6,
        }}
      >
        {String(Math.min(25, time)).padStart(2, "0")}s / 25s
      </div>
      <div
        style={{
          position: "absolute",
          left: 58,
          right: 58,
          bottom: 26,
          height: 1,
          background: "rgba(200,255,236,0.12)",
        }}
      >
        <div
          style={{
            width: `${clamp(progress) * 100}%`,
            height: 1,
            background: ACCENT,
            boxShadow: `0 0 10px ${ACCENT}77`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const AppPanel: React.FC<{
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  delay?: number;
  rotate?: number;
  label?: string;
  bright?: boolean;
  imageScale?: number;
}> = ({
  src,
  left,
  top,
  width,
  height,
  delay = 8,
  rotate = -4,
  label,
  bright = false,
  imageScale = 1,
}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 70, 20);
  const scan = (frame * 0.015 + 0.12) % 1.1;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        perspective: 1500,
        opacity: interpolate(p, [0, 0.75], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateX(${(1 - p) * 70}px) translateY(${(1 - p) * 22}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 16,
          background: `radial-gradient(circle, ${ACCENT}22, transparent 68%)`,
          filter: "blur(30px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(36,245,184,0.26)",
          boxShadow: "0 34px 100px rgba(0,0,0,0.68)",
          transform: `rotateY(${rotate}deg) rotateX(1.5deg)`,
          background: "#06110D",
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${imageScale})`,
            transformOrigin: "top left",
            filter: `brightness(${bright ? 1.45 : 0.82}) contrast(1.04) saturate(${bright ? 0.95 : 0.82})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(125deg, rgba(2,7,5,${bright ? 0.02 : 0.1}) 0%, rgba(2,7,5,${bright ? 0.1 : 0.3}) 56%, rgba(2,7,5,${bright ? 0.24 : 0.62}) 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${scan * 100}%`,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${ACCENT}66, transparent)`,
            opacity: 0.5,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 20,
            top: 18,
            display: "flex",
            gap: 7,
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: i === 0 ? ACCENT : "rgba(236,249,243,0.26)",
              }}
            />
          ))}
        </div>
        {label ? (
          <div
            style={{
              position: "absolute",
              left: 20,
              bottom: 16,
              color: ACCENT,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 2,
            }}
          >
            {label}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            right: 16,
            bottom: 14,
            width: 8,
            height: 8,
            borderRight: `1px solid ${ACCENT}99`,
            borderBottom: `1px solid ${ACCENT}99`,
          }}
        />
      </div>
    </div>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const title = enter(frame, 10, 75, 16);
  const reveal = interpolate(frame, [8, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const glyph = interpolate(frame, [0, 120], [-8, 8]);
  return (
    <SceneFade duration={120}>
      <Absent />
      <div
        style={{
          position: "absolute",
          left: 138,
          top: 296,
          width: 1120,
        }}
      >
        <Kicker>A CONLANGER'S WORKBENCH</Kicker>
        <div
          style={{
            marginTop: 26,
            color: INK,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 158,
            lineHeight: 0.9,
            letterSpacing: interpolate(title, [0, 1], [26, 2]),
            clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`,
            transform: `translateY(${(1 - title) * 40}px)`,
          }}
        >
          LANGSCAPE
        </div>
        <div
          style={{
            width: `${reveal * 700}px`,
            height: 2,
            marginTop: 30,
            background: `linear-gradient(90deg, ${ACCENT}, transparent)`,
          }}
        />
        <Rise delay={38} style={{ marginTop: 28 }}>
          <div
            style={{
              color: "#CFE9DF",
              fontFamily: SANS,
              fontSize: 31,
              letterSpacing: -0.3,
            }}
          >
            Fonts. Sound changes. Structure.
          </div>
        </Rise>
        <Rise delay={50} style={{ marginTop: 18, display: "flex", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              border: "1px solid rgba(36,245,184,0.28)",
              padding: "8px 13px",
              color: ACCENT,
              fontFamily: MONO,
              fontSize: 12,
              letterSpacing: 2.2,
            }}
          >
            FOR OBSIDIAN
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: ACCENT }} />
          </span>
        </Rise>
      </div>
      <div
        style={{
          position: "absolute",
          right: 105,
          top: 312,
          color: ACCENT,
          opacity: 0.08,
          fontFamily: GOTHIC,
          fontSize: 190,
          lineHeight: 1,
          transform: `rotate(${glyph}deg) translateY(${glyph * 2}px)`,
        }}
      >
        𐌻𐌰𐌽𐌲𐍃𐌺𐌰𐍀
      </div>
      <svg
        style={{ position: "absolute", right: 215, top: 330, opacity: 0.35 }}
        width="450"
        height="450"
        viewBox="0 0 450 450"
        fill="none"
      >
        <circle
          cx="225"
          cy="225"
          r="170"
          stroke={ACCENT}
          strokeOpacity="0.35"
          strokeDasharray="1 13"
          transform={`rotate(${-frame * 0.12} 225 225)`}
        />
        <circle cx="225" cy="225" r="214" stroke={ACCENT} strokeOpacity="0.08" />
        <path d="M225 12 L225 42 M225 408 L225 438 M12 225 L42 225 M408 225 L438 225" stroke={ACCENT} strokeOpacity="0.45" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 140,
          bottom: 110,
          display: "flex",
          gap: 26,
          alignItems: "center",
          color: "rgba(185,232,217,0.36)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 1.8,
        }}
      >
        <span>01 / INTRO</span>
        <span style={{ width: 60, height: 1, background: "rgba(185,232,217,0.2)" }} />
        <span>FONTS</span>
        <span>SOUND</span>
        <span>STRUCTURE</span>
      </div>
    </SceneFade>
  );
};

const Absent: React.FC = () => null;

const FontsScene: React.FC = () => (
  <SceneFade duration={135}>
    <div style={{ position: "absolute", left: 138, top: 245, width: 640 }}>
      <Kicker>01 / CUSTOM WRITING SYSTEMS</Kicker>
      <Headline delay={10} size={84} style={{ marginTop: 24 }}>
        WRITE IN
        <br />
        <AccentText>ANY SCRIPT.</AccentText>
      </Headline>
      <Body delay={28} width={560} style={{ marginTop: 28 }}>
        Drop a font into the vault. Use it inline with a brace.
        Your writing system renders anywhere Markdown does.
      </Body>
      <Rise delay={40} style={{ display: "flex", gap: 9, marginTop: 30 }}>
        <Chip>TTF</Chip>
        <Chip>OTF</Chip>
        <Chip>INLINE {"{font: text}"}</Chip>
      </Rise>
    </div>
    <div
      style={{
        position: "absolute",
        left: 825,
        top: 150,
        color: ACCENT,
        opacity: 0.3,
        fontFamily: GOTHIC,
        fontSize: 88,
        transform: "rotate(-7deg)",
      }}
    >
      𐌰𐍆𐌰
    </div>
    <div
      style={{
        position: "absolute",
        left: 110,
        bottom: 105,
        color: ACCENT,
        opacity: 0.12,
        fontFamily: GOTHIC,
        fontSize: 90,
      }}
    >
      𐌻𐌰𐌽
    </div>
    <AppPanel
      src="font-demo.png"
      left={938}
      top={250}
      width={960}
      height={540}
      rotate={-5}
      label="CUSTOM FONT / LIVE PREVIEW"
    />
    <div
      style={{
        position: "absolute",
        left: 900,
        bottom: 88,
        color: "rgba(185,232,217,0.4)",
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
      }}
    >
      FONT FILES LOADED DIRECTLY FROM YOUR VAULT
    </div>
  </SceneFade>
);

const LexurgyScene: React.FC = () => (
  <SceneFade duration={105}>
    <div style={{ position: "absolute", left: 1160, top: 235, width: 640 }}>
      <Kicker>02 / LEXURGY</Kicker>
      <Headline delay={10} size={82} style={{ marginTop: 24 }}>
        SOUND
        <br />
        <AccentText>CHANGES.</AccentText>
      </Headline>
      <div
        style={{
          color: ACCENT,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 2.6,
          marginTop: 18,
          opacity: 0.9,
        }}
      >
        VALIDATED LIVE.
      </div>
      <Body delay={28} width={560} style={{ marginTop: 22 }}>
        Write Lexurgy rules, run them against any words,
        and inspect every rule that touched them.
      </Body>
      <Rise delay={42} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 30 }}>
        <Chip>p → b / V _ V</Chip>
        <Chip>a → e</Chip>
        <Chip>b → p / _ #</Chip>
      </Rise>
    </div>
    <AppPanel
      src="lexurgy-editor.png"
      left={110}
      top={248}
      width={1000}
      height={562}
      delay={6}
      rotate={4}
      label="LEXURGY / RULE TRACE"
    />
    <div
      style={{
        position: "absolute",
        left: 155,
        bottom: 80,
        color: "rgba(185,232,217,0.4)",
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
      }}
    >
      TEST BENCH / MULTI-WORD TRACE
    </div>
  </SceneFade>
);

const CanvasScene: React.FC = () => (
  <SceneFade duration={105}>
    <div style={{ position: "absolute", left: 138, top: 112, width: 720 }}>
      <Kicker>03 / PIPELINES</Kicker>
      <Headline delay={10} size={68} style={{ marginTop: 20 }}>
        WORDS IN.
        <br />
        <AccentText>WORLDS OUT.</AccentText>
      </Headline>
      <Body delay={26} width={610} style={{ marginTop: 17, fontSize: 22 }}>
        Chain source words, sound changes, and outputs together
        on a canvas. Run the whole evolution in one pass.
      </Body>
    </div>
    <Rise delay={36} style={{ position: "absolute", left: 980, top: 350, display: "flex", gap: 15 }}>
      {["SOURCE", "CHANGE", "OUTPUT"].map((item, i) => (
        <React.Fragment key={item}>
          <div
            style={{
              color: i === 2 ? ACCENT : "#B9E8D9",
              fontFamily: MONO,
              fontSize: 12,
              letterSpacing: 2,
              paddingBottom: 8,
              borderBottom: `1px solid ${i === 2 ? ACCENT : "rgba(185,232,217,0.2)"}`,
            }}
          >
            {item}
          </div>
          {i < 2 ? <span style={{ color: ACCENT, fontFamily: MONO, fontSize: 15 }}>→</span> : null}
        </React.Fragment>
      ))}
    </Rise>
    <AppPanel
      src="canvas.png"
      left={480}
      top={430}
      width={1100}
      height={619}
      delay={8}
      rotate={-1.5}
      label="CANVAS / PIPELINE"
    />
    <div
      style={{
        position: "absolute",
        left: 140,
        bottom: 85,
        color: "rgba(185,232,217,0.4)",
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
      }}
    >
      CONNECT CARDS WITH CANVAS ARROWS / PRESS RUN
    </div>
  </SceneFade>
);

type TreeNode = {
  id: string;
  x: number;
  y: number;
  parent?: string;
  accent?: boolean;
};

const TREE_NODES: TreeNode[] = [
  { id: "S", x: 430, y: 76 },
  { id: "NP", x: 270, y: 240, parent: "S" },
  { id: "VP", x: 600, y: 240, parent: "S" },
  { id: "Det", x: 160, y: 400, parent: "NP" },
  { id: "N", x: 350, y: 400, parent: "NP", accent: true },
  { id: "V", x: 600, y: 400, parent: "VP" },
  { id: "the", x: 160, y: 560, parent: "Det" },
  { id: "cat", x: 350, y: 560, parent: "N" },
  { id: "die", x: 600, y: 560, parent: "V" },
];

const TreeGraphic: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [14, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const ghost = interpolate(frame, [62, 104], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const ghostX = interpolate(ghost, [0, 1], [600, 444]);
  const ghostY = interpolate(ghost, [0, 1], [560, 560]);
  const ghostOpacity = interpolate(frame, [58, 66, 108], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const originalOpacity = interpolate(frame, [62, 78], [1, 0.18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", left: 930, top: 170, width: 840, height: 720 }}>
      <svg
        width="840"
        height="720"
        viewBox="0 0 840 720"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {TREE_NODES.filter((node) => node.parent).map((node, index) => {
          const parent = TREE_NODES.find((entry) => entry.id === node.parent)!;
          const p = interpolate(frame, [10 + index * 2, 42 + index * 2], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          });
          return (
            <line
              key={node.id}
              x1={parent.x}
              y1={parent.y + 20}
              x2={node.x}
              y2={node.y - 20}
              stroke={ACCENT}
              strokeOpacity={0.58}
              strokeWidth={1.5}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - p}
            />
          );
        })}
        <line
          x1={350}
          y1={420}
          x2={ghostX}
          y2={ghostY - 24}
          stroke={ACCENT}
          strokeWidth={2}
          opacity={ghostOpacity}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ghost}
        />
      </svg>
      {TREE_NODES.map((node, index) => {
        const p = enter(frame, 18 + index * 3, 100, 18);
        const isGhostOriginal = node.id === "die";
        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: node.x - 70,
              top: node.y - 22,
              width: 140,
              textAlign: "center",
              color: node.accent ? ACCENT : "#DCEFE8",
              fontFamily: SANS,
              fontSize: node.id.length <= 2 ? 31 : 29,
              fontWeight: node.id.length <= 2 ? 600 : 400,
              opacity:
                interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }) *
                (isGhostOriginal ? originalOpacity : 1),
              transform: `translateY(${(1 - p) * 16}px)`,
              whiteSpace: "nowrap",
            }}
          >
            {node.id}
          </div>
        );
      })}
      {ghostOpacity > 0 ? (
        <div
          style={{
            position: "absolute",
            left: ghostX - 55,
            top: ghostY - 22,
            width: 110,
            textAlign: "center",
            color: ACCENT,
            fontFamily: SANS,
            fontSize: 29,
            fontWeight: 400,
            opacity: ghostOpacity,
            textShadow: `0 0 22px ${ACCENT}66`,
          }}
        >
          die
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 348,
          top: 372,
          width: 20,
          height: 20,
          border: `1px solid ${ACCENT}`,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          color: ACCENT,
          fontFamily: MONO,
          fontSize: 14,
          opacity: 0.9,
        }}
      >
        +
      </div>
      <div
        style={{
          position: "absolute",
          left: 582,
          top: 372,
          width: 20,
          height: 20,
          border: `1px solid ${ACCENT}66`,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          color: ACCENT,
          fontFamily: MONO,
          fontSize: 14,
          opacity: 0.55,
        }}
      >
        ×
      </div>
      <div
        style={{
          position: "absolute",
          left: 400,
          top: 632,
          color: "rgba(185,232,217,0.4)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 2,
          opacity: interpolate(frame, [80, 95], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        DRAG TO REPARENT / GHOST PREVIEW
      </div>
    </div>
  );
};

const TreeScene: React.FC = () => (
  <SceneFade duration={135}>
    <div style={{ position: "absolute", left: 138, top: 240, width: 620 }}>
      <Kicker>04 / SYNTAX TREES</Kicker>
      <Headline delay={10} size={80} style={{ marginTop: 24 }}>
        STRUCTURE
        <br />
        <AccentText>IN MOTION.</AccentText>
      </Headline>
      <Body delay={28} width={550} style={{ marginTop: 24 }}>
        Hover to add. Click to rename. Drag a node to move
        its whole subtree, with a ghost preview of where it lands.
      </Body>
      <Rise delay={42} style={{ display: "flex", gap: 9, marginTop: 28 }}>
        <Chip>ADD CHILD</Chip>
        <Chip>REPARENT</Chip>
        <Chip>FONTS IN LABELS</Chip>
      </Rise>
    </div>
    <TreeGraphic />
  </SceneFade>
);

const BasesCard: React.FC = () => {
  const frame = useCurrentFrame();
  const p = enter(frame, 4, 80, 20);
  const rows = [
    { word: "kala", gloss: "word", script: "𐌺𐌰𐌻𐌰" },
    { word: "sena", gloss: "river", script: "𐍃𐌴𐌽𐌰" },
    { word: "mira", gloss: "star", script: "𐌼𐌹𐍂𐌰" },
    { word: "tova", gloss: "stone", script: "𐍄𐍉𐍅𐌰" },
  ];
  const active = Math.min(3, Math.max(0, Math.floor((frame - 16) / 11)));
  return (
    <div
      style={{
        position: "absolute",
        left: 900,
        top: 250,
        width: 840,
        height: 520,
        opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${(1 - p) * 26}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 30,
          background: `radial-gradient(circle, ${ACCENT}22, transparent 66%)`,
          filter: "blur(28px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 18,
          border: "1px solid rgba(36,245,184,0.25)",
          background: "rgba(5,14,11,0.94)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
          padding: "28px 30px",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 7, height: 7, background: ACCENT, borderRadius: "50%" }} />
            <span style={{ color: "#D9EFE6", fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
              FONT BASE
            </span>
            <span style={{ color: "rgba(185,232,217,0.4)", fontFamily: MONO, fontSize: 11 }}>
              / LEXICON
            </span>
          </div>
          <span style={{ color: "rgba(185,232,217,0.4)", fontFamily: MONO, fontSize: 11 }}>
            4 RESULTS
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.15fr 1.1fr 1fr",
            marginTop: 30,
            paddingBottom: 10,
            borderBottom: "1px solid rgba(185,232,217,0.12)",
            color: "rgba(185,232,217,0.45)",
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.6,
          }}
        >
          <span>WORD</span>
          <span>GLOSS</span>
          <span>SCRIPT</span>
        </div>
        {rows.map((row, i) => {
          const rowP = enter(frame, 12 + i * 7, 100, 20);
          const isActive = i === active;
          return (
            <div
              key={row.word}
              style={{
                display: "grid",
                gridTemplateColumns: "1.15fr 1.1fr 1fr",
                alignItems: "center",
                height: 72,
                borderBottom: "1px solid rgba(185,232,217,0.07)",
                opacity: interpolate(rowP, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
                transform: `translateY(${(1 - rowP) * 10}px)`,
                position: "relative",
              }}
            >
              {isActive ? (
                <span
                  style={{
                    position: "absolute",
                    left: -30,
                    right: -30,
                    top: 0,
                    bottom: 0,
                    background: `linear-gradient(90deg, ${ACCENT}12, transparent 70%)`,
                    borderLeft: `2px solid ${ACCENT}`,
                  }}
                />
              ) : null}
              <span style={{ color: isActive ? INK : "#B9D8CC", fontFamily: MONO, fontSize: 16 }}>
                {row.word}
              </span>
              <span style={{ color: "rgba(185,232,217,0.52)", fontFamily: SANS, fontSize: 18 }}>
                {row.gloss}
              </span>
              <span style={{ color: isActive ? ACCENT : "#CFE9DE", fontFamily: GOTHIC, fontSize: 30 }}>
                {row.script}
              </span>
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 30,
            bottom: 18,
            color: ACCENT,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 2,
            opacity: 0.85,
          }}
        >
          BASES / FONT LABELS
        </div>
        <div
          style={{
            position: "absolute",
            right: 24,
            bottom: 18,
            color: "rgba(185,232,217,0.36)",
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.4,
          }}
        >
          RENDERED WITH LANGSCAPE
        </div>
      </div>
    </div>
  );
};

const BasesScene: React.FC = () => (
  <SceneFade duration={75} fadeIn={8} fadeOut={10}>
    <div style={{ position: "absolute", left: 138, top: 280, width: 650 }}>
      <Kicker>05 / BASES</Kicker>
      <Headline delay={8} size={78} style={{ marginTop: 24 }}>
        YOUR WORDS.
        <br />
        <AccentText>EVERY VIEW.</AccentText>
      </Headline>
      <Body delay={22} width={570} style={{ marginTop: 22 }}>
        Custom fonts follow your lexemes into tables, cards,
        and embedded views. One vault, one visual language.
      </Body>
    </div>
    <BasesCard />
    <div
      style={{
        position: "absolute",
        left: 138,
        bottom: 90,
        color: ACCENT,
        fontFamily: GOTHIC,
        fontSize: 56,
        opacity: 0.3,
      }}
    >
      𐌰𐍆𐌰
    </div>
  </SceneFade>
);

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const p = enter(frame, 4, 80, 18);
  const line = interpolate(frame, [10, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <SceneFade duration={75} fadeIn={8} fadeOut={16}>
      <div style={{ position: "absolute", left: 138, top: 272, width: 1050 }}>
        <Kicker>LANGSCAPE / FOR OBSIDIAN</Kicker>
        <div
          style={{
            color: INK,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 112,
            letterSpacing: interpolate(p, [0, 1], [18, 1]),
            lineHeight: 1,
            marginTop: 24,
            opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Build worlds.
        </div>
        <div
          style={{
            color: ACCENT,
            fontFamily: SANS,
            fontSize: 38,
            letterSpacing: -0.3,
            marginTop: 12,
            opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Language by language.
        </div>
        <div
          style={{
            width: `${line * 600}px`,
            height: 2,
            marginTop: 34,
            background: `linear-gradient(90deg, ${ACCENT}, transparent)`,
          }}
        />
        <Rise delay={26} style={{ marginTop: 24 }}>
          <div style={{ color: "rgba(185,232,217,0.55)", fontFamily: MONO, fontSize: 14, letterSpacing: 1.4 }}>
            github.com/KeylimeVI/Langscape
          </div>
        </Rise>
      </div>
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 300,
          fontFamily: GOTHIC,
          fontSize: 180,
          color: ACCENT,
          opacity: 0.08,
          transform: `translateY(${Math.sin(frame / 14) * 5}px)`,
        }}
      >
        𐌻𐌰𐌽𐌲𐍃𐌺𐌰𐍀
      </div>
      <div
        style={{
          position: "absolute",
          right: 138,
          bottom: 100,
          color: ACCENT,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 2.2,
          opacity: 0.5,
        }}
      >
        FONTS / SOUND / STRUCTURE / PIPELINES
      </div>
    </SceneFade>
  );
};

export const Trailer: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <FontLoader />
      <GlobalStyle />
      <Backdrop />
      <Audio src={staticFile("trailer-music.wav")} volume={0.9} />
      <Sequence from={TIMING.intro.from} durationInFrames={TIMING.intro.duration}>
        <Intro />
      </Sequence>
      <Sequence from={TIMING.fonts.from} durationInFrames={TIMING.fonts.duration}>
        <FontsScene />
      </Sequence>
      <Sequence from={TIMING.lexurgy.from} durationInFrames={TIMING.lexurgy.duration}>
        <LexurgyScene />
      </Sequence>
      <Sequence from={TIMING.canvas.from} durationInFrames={TIMING.canvas.duration}>
        <CanvasScene />
      </Sequence>
      <Sequence from={TIMING.trees.from} durationInFrames={TIMING.trees.duration}>
        <TreeScene />
      </Sequence>
      <Sequence from={TIMING.bases.from} durationInFrames={TIMING.bases.duration}>
        <BasesScene />
      </Sequence>
      <Sequence from={TIMING.outro.from} durationInFrames={TIMING.outro.duration}>
        <Outro />
      </Sequence>
      <Hud />
    </AbsoluteFill>
  );
};
