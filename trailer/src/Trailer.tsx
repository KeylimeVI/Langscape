import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, useDelayRender } from "remotion";

const teal = "#38e5c3";
const ink = "#ecf4f3";
const muted = "#a5b5b7";
const bg = "#0b0e12";
const mono = "'Liberation Mono', monospace";
const sans = "'Liberation Sans', Arial, sans-serif";
const logo = "lam-alif.svg";
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const cut = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const anim = (frame: number, start: number, stop: number) => interpolate(frame, [start, stop], [0, 1], { ...cut, easing: ease });
const pad = (n: number) => String(n).padStart(2, "0");
const capture = (file: string) => staticFile(`narevu/${file}.png`);

const FontLoader: React.FC = () => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Load Narevu Script"));
  useEffect(() => {
    document.fonts.load('100px "Narevu Script"').then((fonts) => {
      if (!fonts.length) throw new Error("Narevu Script did not load");
      continueRender(handle);
    }).catch(cancelRender);
  }, [handle, continueRender, cancelRender]);
  return null;
};

const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 77% 9%, #153130 0%, #101a20 28%, ${bg} 71%)` }}>
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(169,217,208,.23) 1px, transparent 1px)", backgroundSize: "32px 32px", opacity: 0.46, maskImage: "linear-gradient(135deg,transparent 35%,black 100%)" }} />
    <div style={{ position: "absolute", inset: 36, border: "1px solid #243337", opacity: 0.6 }} />
    {[[36, 36], [36, 1036], [1876, 36], [1876, 1036]].map(([x, y]) => (
      <div key={`${x}:${y}`} style={{ position: "absolute", left: x, top: y, width: 7, height: 7, background: teal, opacity: 0.6 }} />
    ))}
  </AbsoluteFill>
);

const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 9, durationInFrames - 9, durationInFrames - 1], [0, 1, 1, 0], cut);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Reveal: React.FC<{ at?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ at = 0, style, children }) => {
  const frame = useCurrentFrame();
  const p = anim(frame, at, at + 24);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 22}px)`, ...style }}>{children}</div>;
};

const Eyebrow: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ color: teal, font: `600 19px ${mono}`, letterSpacing: 4, textTransform: "uppercase", ...style }}>{children}</div>
);

const HUD: React.FC<{ index: number; name: string }> = ({ index, name }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <div style={{ position: "absolute", bottom: 57, left: 94, right: 94, display: "flex", alignItems: "center", justifyContent: "space-between", color: muted, font: `18px ${mono}`, letterSpacing: 2 }}>
    <div><span style={{ color: teal }}>{pad(index)} / 04</span><span style={{ marginLeft: 22 }}>{name}</span></div>
    <div style={{ display: "flex", gap: 8 }}>
      {[1, 2, 3, 4].map((n) => <div key={n} style={{ height: 3, width: 39, background: "#314246", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, right: "auto", background: teal, width: n < index ? "100%" : n === index ? `${100 * frame / Math.max(1, durationInFrames - 1)}%` : 0 }} />
      </div>)}
    </div>
    <div>LANGSCAPE 1.0</div>
  </div>;
};

const Headline: React.FC<{ number: number; label: string; title: string; side?: React.ReactNode }> = ({ number, label, title, side }) => (
  <Reveal at={3} style={{ position: "absolute", left: 94, right: 94, top: 66, display: "flex", alignItems: "end", justifyContent: "space-between" }}>
    <div><Eyebrow>{pad(number)} / {label}</Eyebrow><div style={{ fontSize: 67, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.06, marginTop: 12 }}>{title}</div></div>
    {side && <div style={{ color: muted, fontSize: 26, lineHeight: 1.3, textAlign: "right", paddingBottom: 5, maxWidth: 660 }}>{side}</div>}
  </Reveal>
);

const Cover: React.FC<{ closing?: boolean }> = ({ closing }) => {
  const frame = useCurrentFrame();
  const p = anim(frame, 3, 57);
  const type = anim(frame, closing ? 6 : 33, closing ? 34 : 67);
  return <Scene>
    <div style={{ position: "absolute", left: 0, right: 0, top: closing ? 190 : 165, textAlign: "center" }}>
      <svg width="310" height="310" viewBox="0 0 310 310" style={{ position: "absolute", left: "calc(50% - 155px)", top: -35, opacity: p }} aria-hidden>
        <circle cx="155" cy="155" r="144" fill="none" stroke="#335453" strokeDasharray="3 9" />
        <circle cx="155" cy="155" r="144" fill="none" stroke={teal} strokeWidth="2" pathLength="100" strokeDasharray={`${p * 26} 100`} transform="rotate(-90 155 155)" />
        {[[155, 11], [155, 299], [11, 155], [299, 155]].map(([x, y]) => <circle key={`${x}:${y}`} cx={x} cy={y} r="4" fill={teal} />)}
      </svg>
      <div style={{ height: 208, display: "grid", placeItems: "center" }}>
        <div style={{ position: "relative", width: 116, height: 171, transform: `scale(${0.89 + 0.11 * p})`, filter: `drop-shadow(0 0 ${p * 22}px #38e5c34d)` }}>
          <div style={{ position: "absolute", inset: 0, background: "#284c4a", mask: `url(${staticFile(logo)}) center / contain no-repeat`, opacity: p }} />
          <div style={{ position: "absolute", inset: 0, background: teal, mask: `url(${staticFile(logo)}) center / contain no-repeat`, clipPath: `inset(${100 * (1 - p)}% 0 0 0)` }} />
        </div>
      </div>
      <div style={{ opacity: type, transform: `translateY(${(1 - type) * 20}px)`, marginTop: 88 }}>
        <Eyebrow>{closing ? "An Obsidian plugin for conlangers" : "Tools for building languages"}</Eyebrow>
        <div style={{ fontSize: 141, lineHeight: 1.02, fontWeight: 700, letterSpacing: -7, marginTop: 14 }}>
          Langscape<span style={{ color: teal, fontWeight: 400, fontSize: 80, letterSpacing: -3, marginLeft: 28 }}>1.0</span>
        </div>
        <div style={{ color: muted, fontSize: 32, marginTop: 21 }}>{closing ? "Get Langscape for Obsidian" : "Write it. Evolve it. Keep it all in your vault."}</div>
      </div>
      {closing && <Reveal at={47} style={{ marginTop: 46 }}>
        <span style={{ display: "inline-block", border: "1px solid #3e7b71", borderRadius: 25, padding: "16px 28px", color: teal, font: `22px ${mono}`, background: "#102624" }}>github.com/KeylimeVI/Langscape</span>
      </Reveal>}
    </div>
  </Scene>;
};

interface Shot { when: number; file: string }
interface Cue { at: number; x: number; y: number }
const Viewport: React.FC<{ shots: Shot[]; at?: number; style?: React.CSSProperties; zoom?: number; origin?: number; cue?: Cue }> = ({ shots, at = 10, style, zoom = 1.09, origin = 0.39, cue }) => {
  const frame = useCurrentFrame();
  const entered = anim(frame, at, at + 23);
  if (frame < at) return null;
  const scale = zoom + 0.022 * anim(frame, at + 20, at + 200);
  const anchor = `50% ${origin * 100}%`;
  return <div style={{ position: "absolute", left: 94, right: 94, top: 207, height: 772, borderRadius: 20, overflow: "hidden", background: "#171e23", border: "1px solid #4f696c", boxShadow: "0 24px 80px #0008", opacity: entered, transform: `translateY(${(1 - entered) * 25}px)`, ...style }}>
    {shots.map(({ file, when }, i) => <Img key={file} src={capture(file)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: anchor, transformOrigin: anchor, transform: `scale(${scale})`, opacity: i === 0 ? 1 : anim(frame, when, when + 5) }} />)}
    {cue && <Cursor cue={cue} scale={scale} origin={origin} />}
  </div>;
};

const Cursor: React.FC<{ cue: Cue; scale: number; origin: number }> = ({ cue, scale, origin }) => {
  const frame = useCurrentFrame();
  const dt = frame - cue.at;
  if (dt < -29 || dt > 20) return null;
  const w = 1730, h = 770; // Inner dimensions of the full-width UI viewport.
  const fit = w / 1600;
  const glide = 1 - anim(dt, -29, -4);
  const x = w / 2 + (cue.x - 800) * fit * scale - glide * 62;
  const y = h * origin + (cue.y - 900 * origin) * fit * scale + glide * 33;
  const opacity = anim(dt, -29, -20) * (1 - anim(dt, 7, 20));
  return <svg width="110" height="110" viewBox="0 0 110 110" style={{ position: "absolute", left: x - 55, top: y - 55, opacity, filter: "drop-shadow(0 3px 4px #0009)" }}>
    {dt >= 0 && <circle cx="55" cy="55" r={8 + 31 * anim(dt, 0, 18)} fill="none" stroke={teal} strokeWidth="3" opacity={1 - anim(dt, 0, 19)} />}
    <path d="M55 55L56 83L63 76L72 84L76 80L68 72L79 71Z" fill={ink} stroke={bg} strokeWidth="2" strokeLinejoin="round" />
  </svg>;
};

const ScriptScene: React.FC = () => {
  const frame = useCurrentFrame();
  const split = anim(frame, 73, 104);
  const glyphColor = "#dcfff5";
  return <Scene>
    <Headline number={1} label="Writing systems" title="Give your language a script." side={<>Narevu · an original showcase language</>} />
    <Viewport shots={[{ when: 0, file: "script-source" }, { when: 121, file: "script" }]} at={76} style={{ left: 630, right: 94 }} zoom={1.07} origin={0.19} />
    <div style={{ position: "absolute", left: 94, top: 207, width: 1732 - 1224 * split, height: 772, borderRadius: 20, border: "1px solid #3c6660", background: "radial-gradient(ellipse at 40% 10%, #163938, #111b20 72%)", padding: 49, overflow: "hidden", opacity: anim(frame, 8, 30) }}>
      <Eyebrow>Script specimen</Eyebrow>
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(transparent 0 87px,#65dccb21 88px 89px)", maskImage: "linear-gradient(transparent 9%,black 37%,black 66%,transparent 92%)" }} />
      <div style={{ position: "absolute", inset: "100px 0 10px" }}>
        {["tapa", "taba"].map((word, i) => <div key={word} style={{ position: "absolute", left: `${50 + (i ? 23 : -23) * (1 - split)}%`, top: `${49 + (i ? 21 : -21) * split}%`, transform: "translate(-50%,-50%)", textAlign: "center", opacity: anim(frame, 16 + i * 12, 49 + i * 12) }}>
          <div style={{ fontFamily: "Narevu Script", color: i ? teal : glyphColor, fontSize: 213 - split * 91, lineHeight: 1, whiteSpace: "nowrap" }}>{word}</div>
          <div style={{ font: `26px ${mono}`, color: i ? teal : muted, marginTop: 21, letterSpacing: 5 }}>{word}</div>
        </div>)}
      </div>
    </div>
    <HUD index={1} name="SCRIPT" />
  </Scene>;
};

const WordChange: React.FC = () => {
  const frame = useCurrentFrame();
  return <span style={{ font: `600 36px ${mono}`, color: ink }}>ta<span style={{ color: muted }}>p</span>a <span style={{ color: muted }}>→</span>{" "}<span style={{ opacity: 0.24 + 0.76 * anim(frame, 74, 97) }}>ta<span style={{ color: teal }}>b</span>a</span></span>;
};

const LexurgyScene: React.FC = () => <Scene>
  <Headline number={2} label="Lexurgy test bench" title="Test your sound changes." side={<WordChange />} />
  <Viewport shots={[{ when: 0, file: "lexurgy-before" }, { when: 73, file: "lexurgy-after" }]} origin={0.18} cue={{ at: 73, x: 1058, y: 178 }} />
  <HUD index={2} name="SOUND CHANGE / VOICE BETWEEN VOWELS" />
</Scene>;

const RecipeScene: React.FC = () => <Scene>
  <Headline number={3} label="Sound-change recipes" title="Evolve a whole lexicon." side={<>New copies. Source notes stay untouched.</>} />
  <Viewport shots={[{ when: 0, file: "recipe-before" }, { when: 63, file: "recipe-after" }, { when: 144, file: "recipe-output" }]} origin={0.44} zoom={1.00} cue={{ at: 63, x: 207, y: 721 }} />
  <HUD index={3} name="RECIPE / SOURCE → DESCENDANT" />
</Scene>;

const StructureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const second = anim(frame, 85, 98);
  return <Scene>
    <Headline number={4} label="Trees & tables" title="Give your notes structure." side={<>{second > 0.5 ? "Build word tables with merged cells." : "Draw and rearrange syntax trees."}</>} />
    <Viewport shots={[{ when: 0, file: "tree" }, { when: 85, file: "table" }]} origin={0.20} />
    <HUD index={4} name={second > 0.5 ? "WORD TABLE" : "SYNTAX TREE"} />
  </Scene>;
};

export const Trailer: React.FC = () => (
  <AbsoluteFill style={{ background: bg, color: ink, fontFamily: sans }}>
    <style>{`@font-face{font-family:'Narevu Script';src:url('${staticFile("NarevuScript.ttf")}') format('truetype');font-display:block} *{box-sizing:border-box}`}</style>
    <FontLoader />
    <Backdrop />
    <Sequence from={0} durationInFrames={120} name="Lām–alif reveal"><Cover /></Sequence>
    <Sequence from={120} durationInFrames={210} name="Narevu specimen"><ScriptScene /></Sequence>
    <Sequence from={330} durationInFrames={240} name="Lexurgy test bench"><LexurgyScene /></Sequence>
    <Sequence from={570} durationInFrames={240} name="Sound-change recipes"><RecipeScene /></Sequence>
    <Sequence from={810} durationInFrames={180} name="Tree and word table"><StructureScene /></Sequence>
    <Sequence from={990} durationInFrames={150} name="Langscape 1.0 end card"><Cover closing /></Sequence>
    <Audio src={staticFile("narevu-score.m4a")} />
  </AbsoluteFill>
);
