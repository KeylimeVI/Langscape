import math, wave
import numpy as np

sr = 48000
duration = 25.0
n = int(sr * duration)
t = np.arange(n) / sr
rng = np.random.default_rng(11)
L = np.zeros(n)
R = np.zeros(n)

def add(sig, start, pan=0.0, gain=1.0):
    i0 = int(start * sr)
    i1 = min(n, i0 + len(sig))
    if i0 >= n:
        return
    seg = sig[: i1 - i0] * gain
    L[i0:i1] += seg * math.sqrt((1 - pan) / 2)
    R[i0:i1] += seg * math.sqrt((1 + pan) / 2)

# Warm, slowly evolving pad. Chords: Am - F - C - G, then Am.
chords = [
    (0.0, 6.5, [110.00, 130.81, 164.81, 220.00]),
    (6.5, 12.5, [87.31, 110.00, 130.81, 174.61]),
    (12.5, 18.5, [130.81, 164.81, 196.00, 261.63]),
    (18.5, 22.5, [98.00, 123.47, 146.83, 196.00]),
    (22.5, 25.0, [110.00, 130.81, 164.81, 220.00]),
]
for start, end, notes in chords:
    length = end - start
    tt = np.arange(int(length * sr)) / sr
    env = np.minimum(1, tt / 0.9) * np.minimum(1, np.maximum(0, (length - tt) / 1.1))
    pad = np.zeros_like(tt)
    for j, freq in enumerate(notes):
        for detune, amp, pan in [(-7, 0.09, -0.55), (7, 0.09, 0.55), (0, 0.06, 0)]:
            f = freq * 2 ** (detune / 1200)
            tone = (
                np.sin(2 * np.pi * f * tt + j * 0.7)
                + 0.22 * np.sin(2 * np.pi * f * 2 * tt + 0.4)
                + 0.08 * np.sin(2 * np.pi * f * 3 * tt)
            )
            tone *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.08 * tt + j)
            add(tone, start, pan, amp)
    add(pad, start, 0, 0.0)

# Soft sub pulse on each beat, giving the trailer a pulse without a hard drum.
bpm = 96
beat = 60 / bpm
for k in range(int(duration / beat)):
    start = k * beat
    tt = np.arange(int(0.55 * sr)) / sr
    env = np.exp(-tt * 8.5) * np.minimum(1, tt / 0.01)
    sub = np.sin(2 * np.pi * 55 * tt) * env
    sub += 0.25 * np.sin(2 * np.pi * 110 * tt) * env
    add(sub, start, 0, 0.10 if k % 2 == 0 else 0.055)

# Glassy arpeggio over the pad.
arp = [0, 2, 1, 3, 2, 1, 3, 0]
for k in range(int(duration / (beat / 2))):
    start = k * beat / 2
    if start >= duration - 0.5:
        break
    chord = next((c for c in chords if c[0] <= start < c[1]), chords[-1])
    freq = chord[2][arp[k % len(arp)]] * 2
    tt = np.arange(int(0.62 * sr)) / sr
    env = np.exp(-tt * 6.0) * np.minimum(1, tt / 0.006)
    tone = np.sin(2 * np.pi * freq * tt) * env * 0.045
    pan = 0.45 * math.sin(k * 1.3)
    add(tone, start, pan, 1.0)

# Scene-change whooshes / airy risers.
for start in [4.0, 8.5, 12.5, 16.0, 20.0, 22.5]:
    length = 0.85
    tt = np.arange(int(length * sr)) / sr
    noise = rng.normal(0, 1, len(tt))
    # smooth noise with a simple moving average
    kern = np.ones(90) / 90
    soft = np.convolve(noise, kern, mode="same")
    env = np.sin(np.pi * tt / length) ** 2
    swoosh = soft * env * 0.11
    add(swoosh, start - 0.35, -0.25 if (start * 10) % 2 else 0.25, 1.0)

# Gentle low air bed.
noise = rng.normal(0, 1, n)
alpha = 0.008
air = np.empty_like(noise)
acc = 0.0
for i in range(n):
    acc += alpha * (noise[i] - acc)
    air[i] = acc
L += air * 0.008
R += np.roll(air, 19) * 0.008

# Fade in/out and normalize.
fade_in = np.minimum(1, t / 1.8)
fade_out = np.minimum(1, np.maximum(0, (duration - t) / 2.2))
L *= fade_in * fade_out
R *= fade_in * fade_out
peak = max(np.max(np.abs(L)), np.max(np.abs(R)), 1e-9)
gain = 0.24 / peak
L = np.tanh(L * gain) * 0.95
R = np.tanh(R * gain) * 0.95
pcm = (np.stack([L, R], axis=1) * 32767).astype("<i2")
with wave.open(".tools/trailer/public/trailer-music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes(pcm.tobytes())
print("wrote", duration)
