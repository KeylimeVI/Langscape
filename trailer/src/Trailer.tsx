import React, { useEffect } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useDelayRender } from "remotion";

const paper = "#f5f5f7";
const graphite = "#101010";
const turquoise = "#69e1cc";
const sans = "Inter, 'Liberation Sans', Arial, sans-serif";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const rise = (frame: number, from: number, to: number) => interpolate(frame, [from, to], [0, 1], { ...clamp, easing: ease });

const OPEN = 108;
const VOWELS = 210;
const SOUND = 165;
const RECIPE = 165;
const GRAMMAR = 135;
const MARKDOWN = 96;
const CLOSE = 144;
export const trailerLength = OPEN + VOWELS + SOUND + RECIPE + GRAMMAR + MARKDOWN + CLOSE;

const Typeface: React.FC = () => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  useEffect(() => {
    const handle = delayRender("Load Inter");
    document.fonts.load('650 100px Inter').then((fonts) => {
      if (!fonts.length) throw new Error("Inter did not load");
      continueRender(handle);
    }).catch(cancelRender);
    return () => continueRender(handle);
  }, [delayRender, continueRender, cancelRender]);
  return <style>{`@font-face{font-family:Inter;src:url('${staticFile("InterVariable.woff2")}') format('woff2');font-weight:100 900;font-display:block} *{box-sizing:border-box}`}</style>;
};

const Lift: React.FC<{ start?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ start = 0, style, children }) => {
  const p = rise(useCurrentFrame(), start, start + 26);
  return <div style={{ opacity: p, transform: `translateY(${30 * (1 - p)}px)`, ...style }}>{children}</div>;
};

const Open: React.FC = () => <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
  <div style={{ fontSize: 132, lineHeight: 0.98, fontWeight: 650, letterSpacing: -7.8 }}>
    <Lift start={3}>A whole conlang.</Lift>
    <Lift start={15} style={{ marginTop: 12, color: turquoise }}>One workspace.</Lift>
  </div>
</AbsoluteFill>;

interface Crop { x: number; y: number; width: number; height: number }
interface Shot { name: string; at?: number; crop: Crop }
interface Cue { at: number; x: number; y: number }
const wide: Crop = { x: 0, y: 81, width: 1600, height: 733 };
const crop = (x: number, y: number, width: number, height: number): Crop => ({ x, y, width, height });

const Cursor: React.FC<{ cue: Cue; project: (x: number, y: number) => [number, number] }> = ({ cue, project }) => {
  const dt = useCurrentFrame() - cue.at;
  if (dt < -21 || dt > 12) return null;
  const [x, y] = project(cue.x, cue.y);
  const glide = 1 - rise(dt, -21, -2);
  const opacity = rise(dt, -21, -15) * (1 - rise(dt, 4, 12));
  return <svg width="32" height="38" viewBox="0 0 32 38" style={{ position: "absolute", left: x - 48 * glide - 1, top: y + 28 * glide - 1, opacity, filter: "drop-shadow(0 1px 2px #0009)" }}>
    <path d="m2 2 1 27 7-6 6 10 5-3-6-9 10-1z" fill="white" stroke="#171717" strokeWidth="2" strokeLinejoin="round" />
  </svg>;
};

const Workspace: React.FC<{ title: string; shots: Shot[]; detail?: React.ReactNode; cue?: Cue; focus?: { at: number; crop: Crop } }> = ({ title, shots, detail, cue, focus }) => {
  const frame = useCurrentFrame();
  const start = rise(frame, 3, 32);
  const W = 1696, H = 777;
  const visible = shots.filter(({ at = 0 }) => frame >= at);
  const active = visible[visible.length - 1] ?? shots[0];
  const zoomProgress = focus ? rise(frame, focus.at, focus.at + 35) : 0;
  const projection = (area: Crop) => {
    const mix = (key: keyof Crop) => area[key] + zoomProgress * ((focus?.crop[key] ?? area[key]) - area[key]);
    const width = mix("width"), height = mix("height");
    const factor = Math.max(W / width, H / height) * (1 + 0.009 * rise(frame, 30, 160));
    const left = (W - width * factor) / 2 - mix("x") * factor;
    const top = (H - height * factor) / 2 - mix("y") * factor;
    return { factor, left, top };
  };
  const project = (x: number, y: number): [number, number] => {
    const { factor, left, top } = projection(active.crop);
    return [left + x * factor, top + y * factor];
  };
  return <AbsoluteFill>
    <Lift start={1} style={{ position: "absolute", top: 70, left: 112, right: 112, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div style={{ fontSize: 77, fontWeight: 650, lineHeight: 1.05, letterSpacing: -4.4 }}>{title}</div>
      {detail && <div style={{ fontSize: 43, fontWeight: 500, color: turquoise, letterSpacing: -0.9 }}>{detail}</div>}
    </Lift>
    <div style={{ position: "absolute", top: 203, left: 112, width: W, height: H, borderRadius: 23, overflow: "hidden", outline: "1px solid #3d3d3d", background: "#1e1e1e", opacity: start, transform: `translateY(${36 * (1 - start)}px)` }}>
      {shots.filter((s) => !s.at || frame >= s.at - 1).map(({ name, at, crop: area }) => {
        const { factor, left, top } = projection(area);
        return <Img key={`${name}:${at ?? 0}`} src={staticFile(`quenya/${name}.png`)} style={{ position: "absolute", width: 1600 * factor, height: 900 * factor, left, top, opacity: at ? rise(frame, at, at + 5) : 1 }} />;
      })}
      {cue && <Cursor cue={cue} project={project} />}
    </div>
  </AbsoluteFill>;
};

const PlainText: React.FC = () => <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
  <div style={{ fontSize: 108, fontWeight: 650, letterSpacing: -6, lineHeight: 1.05 }}>
    <Lift start={2}>Your notes stay Markdown.</Lift>
    <Lift start={14} style={{ marginTop: 16, color: turquoise }}>Your files stay in your vault.</Lift>
  </div>
</AbsoluteFill>;

const End: React.FC = () => {
  const frame = useCurrentFrame();
  const appear = rise(frame, 1, 28);
  return <AbsoluteFill style={{ alignItems: "center", textAlign: "center" }}>
    <div style={{ position: "absolute", top: 214, display: "grid", placeItems: "center", width: 199, height: 199, borderRadius: "50%", background: turquoise, opacity: appear, transform: `scale(${0.92 + 0.08 * appear})` }}>
      <div style={{ width: 78, height: 115, background: graphite, mask: `url(${staticFile("lam-alif.svg")}) center / contain no-repeat` }} />
    </div>
    <Lift start={12} style={{ position: "absolute", top: 475, left: 0, right: 0, fontSize: 139, lineHeight: 1.1, fontWeight: 650, letterSpacing: -8 }}>Langscape 1.0</Lift>
    <Lift start={25} style={{ position: "absolute", top: 660, left: 0, right: 0, fontSize: 47, color: "#cecece", letterSpacing: -1 }}>An open-source plugin for Obsidian</Lift>
    <Lift start={40} style={{ position: "absolute", top: 783, left: 0, right: 0, fontSize: 37 }}>github.com/KeylimeVI/Langscape</Lift>
  </AbsoluteFill>;
};

export const Trailer: React.FC = () => (
  <AbsoluteFill style={{ background: graphite, color: paper, fontFamily: sans }}>
    <Typeface />
    <Sequence from={0} durationInFrames={OPEN} name="One workspace"><Open /></Sequence>
    <Sequence from={OPEN} durationInFrames={VOWELS} name="Quenya vowels">
      <Workspace title="Quenya vowels" detail="IPA and Tengwar" focus={{ at: 51, crop: crop(226, 215, 1168, 535) }} shots={[{ name: "vowels", crop: wide }]} />
    </Sequence>
    <Sequence from={OPEN + VOWELS} durationInFrames={SOUND} name="Sound changes">
      <Workspace title="Test sound changes" detail="ñoldo → noldo" cue={{ at: 57, x: 1416, y: 151 }} shots={[{ name: "sound-before", crop: wide }, { name: "sound-after", at: 57, crop: wide }, { name: "sound-after", at: 91, crop: crop(838, 437, 762, 388) }]} />
    </Sequence>
    <Sequence from={OPEN + VOWELS + SOUND} durationInFrames={RECIPE} name="Lexicon recipe">
      <Workspace title="Apply them to your lexicon" cue={{ at: 58, x: 176, y: 739 }} shots={[{ name: "recipe-before", crop: wide }, { name: "recipe-after", at: 62, crop: wide }]} />
    </Sequence>
    <Sequence from={OPEN + VOWELS + SOUND + RECIPE} durationInFrames={GRAMMAR} name="Quenya grammar">
      <Workspace title="Document the grammar" detail="alda · tree" shots={[{ name: "grammar", crop: crop(229, 94, 1175, 540) }]} />
    </Sequence>
    <Sequence from={OPEN + VOWELS + SOUND + RECIPE + GRAMMAR} durationInFrames={MARKDOWN} name="Your notes are Markdown"><PlainText /></Sequence>
    <Sequence from={trailerLength - CLOSE} durationInFrames={CLOSE} name="Langscape 1.0"><End /></Sequence>
    <Audio src={staticFile("quenya-music.m4a")} />
  </AbsoluteFill>
);
