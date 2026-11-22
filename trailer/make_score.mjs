// Original instrumental score for the Langscape 1.0 trailer.
// Run from any directory with Node and FFmpeg; writes a 38-second stereo AAC asset.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rate = 48000;
const duration = 38;
const channels = [new Float32Array(rate * duration), new Float32Array(rate * duration)];
const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const tau = Math.PI * 2;
const chords = [
  [0, 4, [45, 52, 59, 64]], [4, 7.5, [41, 48, 55, 60]], [7.5, 11, [48, 55, 62, 64]],
  [11, 15, [43, 50, 57, 62]], [15, 19, [45, 52, 59, 64]], [19, 23, [41, 48, 55, 60]],
  [23, 27, [48, 55, 62, 64]], [27, 30, [43, 50, 57, 62]], [30, 33, [40, 47, 54, 59]],
  [33, 38, [45, 52, 59, 64]],
];

function voice(start, length, gain, pan, sound) {
  const left = gain * Math.sqrt((1 - pan) * 0.5);
  const right = gain * Math.sqrt((1 + pan) * 0.5);
  const first = Math.round(start * rate);
  const count = Math.min(Math.round(length * rate), channels[0].length - first);
  for (let i = 0; i < count; i++) {
    const s = sound(i / rate);
    channels[0][first + i] += s * left;
    channels[1][first + i] += s * right;
  }
}

function pluck(start, note, gain, pan) {
  const f = hz(note);
  const sound = (t) => {
    const a = tau * f * t;
    return (Math.sin(a) + 0.22 * Math.sin(a * 2.003) * Math.exp(-3.6 * t)
      + 0.10 * Math.sin(a * 3.01) * Math.exp(-7.2 * t)) * (1 - Math.exp(-t * 170)) * Math.exp(-t * 3.45);
  };
  voice(start, 1.4, gain, pan, sound);
  voice(start + 0.27, 1.4, gain * 0.20, -pan, sound);
  voice(start + 0.49, 1.4, gain * 0.10, pan, sound);
}

for (const [start, end, notes] of chords) {
  const length = end - start;
  notes.forEach((note, i) => {
    const f = hz(note);
    const env = (t) => Math.sin(Math.PI * Math.min(1, t / length)) ** 1.2;
    for (const pan of [-0.55, 0.55]) {
      voice(start, length, i ? 0.052 : 0.076, pan, (t) => {
        const phase = tau * f * t * (1 + 0.0024 * pan) + i * 1.2;
        return (Math.sin(phase) + 0.14 * Math.sin(2 * phase + i)) * env(t) * (0.86 + 0.14 * Math.sin(1.2 * t + i));
      });
    }
  });
}

for (let i = 0; i < 67; i++) {
  const start = 1.65 + i * 0.5 + (i % 2) * 0.022;
  const notes = chords.find(([a, b]) => start >= a && start < b)[2];
  if (i % 4 !== 3 || (start > 11 && start < 30)) {
    const index = [2, 3, 1, 3, 2, 1, 3, 2][i % 8];
    pluck(start, notes[index] + (i % 8 === 5 ? 24 : 12), i % 4 === 0 ? 0.091 : 0.053, Math.sin(i * 1.8) * 0.53);
  }
  if (i % 2 === 0 && start >= 4 && start < 33) {
    voice(start, 0.48, i % 4 === 0 ? 0.126 : 0.067, 0, (t) => Math.sin(tau * (49 * t + 3.4 * (1 - Math.exp(-26 * t)))) * Math.exp(-t * 12) * Math.min(1, t * 210));
  }
}

let random = 7;
for (const [i, time] of [4, 11, 13.43, 19, 21.1, 27, 29.83, 33].entries()) {
  let air = 0;
  voice(time - 0.32, 0.61, i % 2 ? 0.18 : 0.21, i % 2 ? 0.31 : -0.31, (t) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = random / 2147483648 - 1;
    air += 0.055 * (noise - air);
    return (0.1 * noise + air) * Math.sin(Math.PI * t / 0.61) ** 2;
  });
}
[64, 69, 76].forEach((note, i) => pluck(33.12 + i * 0.15, note, 0.095, (i - 1) * 0.37));

const raw = Buffer.alloc(rate * duration * 4);
for (let i = 0; i < channels[0].length; i++) {
  const t = i / rate;
  const fade = Math.min(1, t / 0.72, (duration - t) / 2.2);
  for (let j = 0; j < 2; j++) raw.writeInt16LE(Math.trunc(Math.tanh(channels[j][i] * 1.9 * fade) * 32767), 4 * i + 2 * j);
}
const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", String(rate), "-ac", "2", "-i", "pipe:0", "-c:a", "aac", "-b:a", "192k", fileURLToPath(new URL("public/narevu-score.m4a", import.meta.url))], { input: raw, stdio: ["pipe", "inherit", "inherit"] });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
