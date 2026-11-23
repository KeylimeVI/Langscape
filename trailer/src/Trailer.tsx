import React, { useEffect } from "react";
import { Freeze, AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, Sequence, staticFile, useCurrentFrame, useDelayRender } from "remotion";

const paper = "#f5f5f5";
const black = "#121212";
const accent = "#2bfb89";
const sans = "Inter, 'Liberation Sans', Arial, sans-serif";
const ease = Easing.bezier(0.33, 0.68, 0.25, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const progress = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], { ...clamp, easing: ease });
const asset = (name: string) => staticFile(`quenya/${name}`);

const introLength = 68;
const demoPace = 1.15;
const automationPace = 1.4;
const lengths = [94, 135, 176, 167, 366, 125, 103] as const;
const writingRate = 1.12 / demoPace;
const writingLastFrame = Math.floor(164 / writingRate);
const fontsCaption = "Use your own fonts directly in your notes";
const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((sum: number, n) => sum + n, introLength));
export const trailerLength = lengths.reduce((sum: number, n) => sum + n, introLength);

const Typeface: React.FC = () => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  useEffect(() => {
    const handle = delayRender("Load Inter");
    void document.fonts.load("650 100px Inter").then((fonts) => {
      if (!fonts.length) throw new Error("Inter did not load");
      continueRender(handle);
    }).catch(cancelRender);
    return () => continueRender(handle);
  }, [delayRender, continueRender, cancelRender]);
  return <style>{`@font-face{font-family:Inter;src:url('${staticFile("InterVariable.woff2")}') format('woff2');font-weight:100 900;font-display:block} *{box-sizing:border-box}`}</style>;
};

const Lift: React.FC<{ at?: number; distance?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at = 1, distance = 24, children, style }) => {
  const p = progress(useCurrentFrame(), at, at + 23);
  return <div style={{ opacity: p, transform: `translateY(${distance * (1 - p)}px)`, ...style }}>{children}</div>;
};

const Introducing: React.FC = () => <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 16 }}>
  <Lift style={{ fontSize: 52, fontWeight: 500, letterSpacing: -1.8 }}>Introducing</Lift>
  <Lift at={8} style={{ fontSize: 128, lineHeight: 1.04, fontWeight: 650, letterSpacing: -7.5, color: accent, marginTop: 12 }}>Langscape</Lift>
</AbsoluteFill>;

const Open: React.FC = () => (
  <AbsoluteFill style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
    <div style={{ width: "100%", transform: "translateY(-12px)" }}>
      <Lift style={{ fontSize: 101, fontWeight: 550, letterSpacing: -5, lineHeight: 1.08 }}>The ultimate <span style={{ color: accent }}>conlanger&apos;s toolkit</span></Lift>
      <Lift at={6} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22, marginTop: 30 }}>
        <span style={{ fontSize: 61, letterSpacing: -2.8, lineHeight: 1 }}>in Obsidian</span>
        <Img src={staticFile("obsidian-logo.svg")} style={{ width: 54, height: 60, objectFit: "contain" }} alt="" />
      </Lift>
    </div>
  </AbsoluteFill>
);

interface Crop { x: number; y: number; width: number; height: number }
interface Position { x: number; y: number }
interface Action extends Position { at: number; glideOnly?: boolean }
interface Keyframe { at: number; crop: Crop }
interface Capture { name: string; at?: number }
const crop = (x: number, y: number, width: number, height: number): Crop => ({ x, y, width, height });
const wide = crop(0, 35, 1600, 830);
const withTabs = crop(0, 0, 1600, 761);
// The captured UI changes just after each click; running the recipe takes a beat longer.
const recipeBeats = [
  { at: 23, x: 478, y: 320, shot: "input-picker" },
  { at: 47, x: 561, y: 474, shot: "input-picked" },
  { at: 72, x: 489, y: 518, shot: "rule-picker" },
  { at: 97, x: 561, y: 605, shot: "rule-picked" },
  { at: 121, x: 478, y: 730, shot: "output-picker" },
  { at: 145, x: 561, y: 653, shot: "ready" },
  { at: 171, x: 450, y: 790, shot: "result", delay: 12 },
  { at: 205, x: 126, y: 98, shot: "expanded" },
  { at: 229, x: 117, y: 163, shot: "after" },
];
const recipeCaptures: Capture[] = [
  { name: "recipe-before.png" },
  ...recipeBeats.map(({ at, shot, delay }) => ({ name: `recipe-${shot}.png`, at: at + (delay ?? 2) })),
];

const W = 1690;
const H = 804;

function cameraAt(frame: number, keys: Keyframe[]): Crop {
  const i = keys.findIndex((key) => key.at > frame);
  if (i === 0) return keys[0].crop;
  if (i === -1) return keys[keys.length - 1].crop;
  const a = keys[i - 1], b = keys[i];
  const t = progress(frame, a.at, b.at);
  const mix = (axis: keyof Crop) => a.crop[axis] + (b.crop[axis] - a.crop[axis]) * t;
  return crop(mix("x"), mix("y"), mix("width"), mix("height"));
}

const Pointer: React.FC<{ frame: number; actions: Action[]; project: (position: Position) => Position }> = ({ frame, actions, project }) => {
  const next = actions.findIndex(action => action.at > frame);
  const target = actions[next < 0 ? actions.length - 1 : next];
  const last = actions[next - 1];
  const approach = Math.min(16, last ? (target.at - last.at) * 0.75 : 16);
  const t = next < 0 ? 1 : progress(frame, target.at - approach, target.at - 1);
  const origin = last ?? { x: target.x - 56, y: target.y + 36 };
  const point = project({ x: origin.x + (target.x - origin.x) * t, y: origin.y + (target.y - origin.y) * t });
  return <>
    {actions.filter(action => !action.glideOnly && frame >= action.at && frame < action.at + 20).map(action => {
      const at = project(action);
      const p = (frame - action.at) / 20;
      return <svg key={action.at} width={128} height={128} viewBox="0 0 128 128" aria-hidden="true" style={{ position: "absolute", left: at.x - 64, top: at.y - 64, pointerEvents: "none" }}>
        <circle cx="64" cy="64" r={9 + 47 * (1 - (1 - p) ** 2)} fill="none" stroke={accent} strokeWidth={3.5} opacity={(1 - p) ** 1.45} />
        <circle cx="64" cy="64" r={5 + 12 * p} fill={accent} opacity={0.28 * (1 - p)} />
      </svg>;
    })}
    <svg width="34" height="39" viewBox="0 0 32 38" aria-hidden="true" style={{ position: "absolute", left: point.x - 2, top: point.y - 2, opacity: progress(frame, actions[0].at - 23, actions[0].at - 14), pointerEvents: "none", filter: "drop-shadow(0 1px 3px #0009)" }}>
      <path d="m2 2 1 27 7-6 6 10 5-3-6-9 10-1z" fill={paper} stroke="#171717" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  </>;
};

const SceneTitle: React.FC<{ title: string; caption?: string }> = ({ title, caption }) => <AbsoluteFill style={{ pointerEvents: "none" }}>
  <Lift at={0} distance={17} style={{ position: "absolute", top: caption ? 49 : 62, left: 88, right: 88, textAlign: "center", fontSize: 67, lineHeight: 1.1, letterSpacing: -4, fontWeight: 650 }}>{title}</Lift>
  {caption && <Lift at={2} distance={9} style={{ position: "absolute", top: 126, left: 88, right: 88, textAlign: "center", fontSize: 25, fontWeight: 450, color: "#d4d4d4" }}>{caption}</Lift>}
</AbsoluteFill>;

const Workspace: React.FC<{ title?: string; caption?: string; pace?: number; keys: Keyframe[]; captures?: Capture[]; clip?: string; actions?: Action[] }> = ({ title, caption, pace = demoPace, keys, captures, clip, actions }) => {
  const actualFrame = useCurrentFrame();
  // A single scene clock keeps the plates, camera, and pointer in sync while slowing the action.
  const frame = actualFrame / pace;
  const enter = progress(frame, -4, 14);
  const area = cameraAt(frame, keys);
  const scale = Math.max(W / area.width, H / area.height);
  const left = (W - area.width * scale) / 2 - area.x * scale;
  const top = (H - area.height * scale) / 2 - area.y * scale;
  const project = ({ x, y }: Position): Position => ({ x: left + x * scale, y: top + y * scale });
  const active = captures?.reduce((prev, next) => frame >= (next.at ?? 0) ? next : prev);
  const media = { position: "absolute", left, top, width: 1600 * scale, height: 900 * scale } as const;
  return <AbsoluteFill>
    {title && <SceneTitle title={title} caption={caption} />}
    <div style={{ position: "absolute", top: 179, left: (1920 - W) / 2, width: W, height: H, borderRadius: 22, overflow: "hidden", outline: "1px solid #ffffff21", boxShadow: "0 24px 70px #0005", background: "#151515", opacity: enter, transform: `translateY(${24 * (1 - enter)}px)` }}>
      {active && <Img src={asset(active.name)} style={media} />}
      {clip && <Freeze frame={writingLastFrame} active={actualFrame > writingLastFrame}><OffthreadVideo muted playbackRate={writingRate} src={asset(clip)} style={media} /></Freeze>}
      {actions?.length ? <Pointer frame={frame} actions={actions} project={project} /> : null}
    </div>
  </AbsoluteFill>;
};

const End: React.FC = () => <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 16 }}>
  <Lift style={{ display: "grid", placeItems: "center", width: 182, height: 182, borderRadius: 45, background: accent }}>
    <div style={{ width: 96, height: 136, background: black, mask: `url(${staticFile("lam-alif.svg")}) center / contain no-repeat` }} />
  </Lift>
  <Lift at={11} style={{ fontSize: 130, lineHeight: 1.02, fontWeight: 650, letterSpacing: -8, marginTop: 46 }}>Langscape</Lift>
  <Lift at={23} style={{ fontSize: 36, letterSpacing: -0.9, color: "#e4e4e4", marginTop: 30 }}>Find it in Community plugins</Lift>
  <Lift at={33} style={{ fontSize: 24, color: "rgba(245, 245, 245, 0.68)", marginTop: 12 }}>github.com/KeylimeVI/Langscape</Lift>
</AbsoluteFill>;

export const Trailer: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at 52% 110%, #16452f 0%, #10251a 38%, #0b0b0b 79%)", color: paper, fontFamily: sans }}>
    <Typeface />
    <Sequence durationInFrames={introLength} name="Introducing Langscape"><Introducing /></Sequence>
    <Sequence from={starts[0]} durationInFrames={lengths[0]} name="Obsidian opener"><Open /></Sequence>
    <Sequence from={starts[1]} durationInFrames={lengths[1] + lengths[2]} name="Writing systems">
      <Sequence durationInFrames={lengths[1]} name="Vowel chart">
        <Workspace keys={[{ at: 0, crop: crop(130, 82, 1340, 638) }, { at: 113, crop: crop(252, 80, 1130, 540) }]} captures={[{ name: "vowels.png" }]} />
      </Sequence>
      <Sequence from={lengths[1]} durationInFrames={lengths[2]} name="The Star-greeting in Tengwar">
        <Workspace keys={[{ at: 0, crop: crop(20, 17, 1560, 742) }, { at: 149, crop: crop(255, 64, 1180, 561) }]} clip="writing.mp4" actions={[{ at: 9, x: 474, y: 305 }, { at: 32, x: 780, y: 446, glideOnly: true }]} />
      </Sequence>
      <SceneTitle title="Writing systems" caption={fontsCaption} />
    </Sequence>
    <Sequence from={starts[3]} durationInFrames={lengths[3]} name="Lexurgy built in">
      <Workspace title="Lexurgy built in" caption="Runs locally with syntax highlighting directly in Obsidian" keys={[{ at: 0, crop: withTabs }, { at: 56, crop: withTabs }, { at: 121, crop: crop(716, 453, 880, 419) }]} captures={[{ name: "sound-before.png" }, { name: "sound-hover.png", at: 34 }, { name: "sound-after.png", at: 51 }]} actions={[{ at: 40, x: 1416, y: 151 }, { at: 69, x: 1518, y: 631, glideOnly: true }]} />
    </Sequence>
    <Sequence from={starts[4]} durationInFrames={lengths[4]} name="Sound change automations">
      <Workspace title="Sound change automations" caption="Batch-apply sound changes to your notes" pace={automationPace} keys={[{ at: 0, crop: withTabs }, { at: 31, crop: withTabs }, { at: 77, crop: crop(0, 170, 1410, 670) }, { at: 145, crop: crop(0, 170, 1410, 670) }, { at: 191, crop: wide }]} captures={recipeCaptures} actions={recipeBeats} />
    </Sequence>
    <Sequence from={starts[5]} durationInFrames={lengths[5]} name="Syntax trees">
      <Workspace title="Syntax trees" caption="Directly in your notes" keys={[{ at: 0, crop: crop(75, 88, 1470, 700) }, { at: 104, crop: crop(106, 102, 1390, 665) }]} captures={[{ name: "syntax.png" }]} />
    </Sequence>
    <Sequence from={starts[6]} durationInFrames={lengths[6]} name="Langscape"><End /></Sequence>
  </AbsoluteFill>
);
