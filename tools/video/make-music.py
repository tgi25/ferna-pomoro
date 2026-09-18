#!/usr/bin/env python3
"""Compose the demo's soundtrack from scratch.

Everything here is synthesised, so the track is original and carries no
licensing or Content-ID risk on Facebook. It is built to sit under a screen
recording: soft pad, a slow bass, a sparse bell arpeggio, and a duck under each
of the app's own alert chimes so those stay audible.

    python3 make-music.py            # writes music.wav and mixed.m4a
"""
import os
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = "/home/claude/pomora"
SR = 48000

INTRO = 3.6
BODY = 65.0
OUTRO = 5.0
TOTAL = INTRO + BODY + OUTRO          # 73.6 s

BPM = 82.0
BEAT = 60.0 / BPM                      # 0.7317 s
BAR = 4 * BEAT                         # 2.927 s

# The app's chimes are built on C major; the music stays in the same key so the
# alerts land inside the harmony instead of clashing with it.
NOTE = {
    "C2": 65.41, "E2": 82.41, "F2": 87.31, "G2": 98.00, "A2": 110.00,
    "C3": 130.81, "D3": 146.83, "E3": 164.81, "F3": 174.61, "G3": 196.00, "A3": 220.00, "B3": 246.94,
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "F4": 349.23, "G4": 392.00, "A4": 440.00, "B4": 493.88,
    "C5": 523.25, "D5": 587.33, "E5": 659.26, "G5": 783.99, "A5": 880.00,
}

# Cmaj7 · Am7 · Fmaj7 · G6 — four bars, repeating.
PROGRESSION = [
    ("C2", ["C3", "E3", "G3", "B3"], ["C4", "E4", "G4", "B4"]),
    ("A2", ["A2", "C3", "E3", "G3"], ["A4", "C5", "E5", "G4"]),
    ("F2", ["F2", "A2", "C3", "E3"], ["F4", "A4", "C5", "E5"]),
    ("G2", ["G2", "B3", "D3", "E3"], ["G4", "B4", "D5", "E5"]),
]


def env(n, attack, release, sustain_level=1.0):
    """Simple AR envelope over n samples, in seconds."""
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e = np.full(n, sustain_level, dtype=np.float32)
    if a < n:
        e[:a] *= np.linspace(0, 1, a, dtype=np.float32) ** 1.5
    if r < n:
        e[-r:] *= np.linspace(1, 0, r, dtype=np.float32) ** 1.8
    return e


def lowpass(x, cutoff):
    """One-pole low-pass — enough to take the edge off raw harmonics."""
    a = 1.0 - np.exp(-2.0 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def partials(freq, dur, weights, detune=0.0):
    t = np.arange(int(dur * SR), dtype=np.float32) / SR
    out = np.zeros_like(t)
    for k, w in enumerate(weights, start=1):
        f = freq * k * (1 + detune)
        out += w * np.sin(2 * np.pi * f * t + np.random.rand())
    return out / max(1e-6, sum(weights))


def place(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * gain


def pad_chord(notes, dur):
    """Warm sustained chord, slightly detuned for width."""
    sig = np.zeros(int(dur * SR), dtype=np.float32)
    for note in notes:
        f = NOTE[note]
        voice = partials(f, dur, [1.0, 0.35, 0.16, 0.07], detune=0.0012)
        voice += partials(f, dur, [1.0, 0.3, 0.12], detune=-0.0015) * 0.7
        sig += voice
    sig /= len(notes)
    return sig * env(len(sig), 0.9, 1.1, 1.0)


def bass_note(note, dur):
    f = NOTE[note]
    sig = partials(f, dur, [1.0, 0.22, 0.06])
    return sig * env(len(sig), 0.06, min(0.9, dur * 0.7))


def bell(note, dur=1.6, bright=1.0):
    """Struck tone, the same family as the app's alert chimes."""
    f = NOTE[note]
    t = np.arange(int(dur * SR), dtype=np.float32) / SR
    sig = (
        np.sin(2 * np.pi * f * t)
        + 0.30 * bright * np.sin(2 * np.pi * f * 2 * t)
        + 0.12 * bright * np.sin(2 * np.pi * f * 3.01 * t)
    )
    return (sig / 1.42) * np.exp(-3.4 * t).astype(np.float32)


def build():
    n = int(TOTAL * SR)
    pad = np.zeros(n, dtype=np.float32)
    bass = np.zeros(n, dtype=np.float32)
    arp = np.zeros(n, dtype=np.float32)

    # Bars run from the very start so the intro card shares the harmony.
    bar_index = 0
    t = 0.0
    while t < TOTAL:
        root, chord, upper = PROGRESSION[bar_index % 4]
        place(pad, t, pad_chord(chord, BAR + 0.6), 0.34)
        place(bass, t, bass_note(root, BAR * 0.92), 0.30)

        # Sparse arpeggio: only while the screen recording is on, and thinned
        # out so it never competes with the captions.
        if INTRO - 0.2 <= t < INTRO + BODY - 2.0:
            pattern = [0, 1.5, 2.5, 3.25] if bar_index % 2 == 0 else [0, 1, 2.5, 3.5]
            for j, step in enumerate(pattern):
                note = upper[j % len(upper)]
                place(arp, t + step * BEAT, bell(note, 1.5, 0.8), 0.16)
        bar_index += 1
        t += BAR

    # A single bell to open on the title card, and one to close on the outro.
    place(arp, 0.55, bell("C5", 2.6, 1.0), 0.22)
    place(arp, INTRO + BODY + 0.35, bell("G4", 3.2, 0.9), 0.20)
    place(arp, INTRO + BODY + 0.75, bell("C5", 3.4, 0.9), 0.18)

    pad = lowpass(pad, 2600)
    bass = lowpass(bass, 420)
    music = pad * 0.85 + bass * 0.9 + arp

    # Duck under each alert chime so the app's own sound stays in front.
    duck = np.ones(n, dtype=np.float32)
    for at, _ in SOUND_CUES:
        start = int((INTRO + at - 0.15) * SR)
        length = int(1.9 * SR)
        if start < 0 or start >= n:
            continue
        end = min(n, start + length)
        shape = np.concatenate([
            np.linspace(1.0, 0.45, int(0.25 * SR), dtype=np.float32),
            np.full(max(0, end - start - int(1.0 * SR)), 0.45, dtype=np.float32),
            np.linspace(0.45, 1.0, int(0.75 * SR), dtype=np.float32),
        ])[: end - start]
        duck[start:start + len(shape)] = np.minimum(duck[start:start + len(shape)], shape)
    music *= duck

    # Overall shape: fade in, ease down under the outro card, fade out.
    music *= env(n, 1.2, 1.6)
    peak = float(np.max(np.abs(music)))
    music = music / peak * 0.42                      # leave headroom for the chimes

    # Gentle stereo width: a few milliseconds of delay on one side.
    delay = int(0.011 * SR)
    left = music.copy()
    right = np.concatenate([np.zeros(delay, dtype=np.float32), music[:-delay]])
    stereo = np.stack([left, right * 0.96], axis=1)

    path = os.path.join(HERE, "build", "music.wav")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = np.clip(stereo, -1, 1)
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((data * 32767).astype("<i2").tobytes())
    return path


# The app's alert chimes, in content time (matching make-video.py).
SOUND_CUES = [
    (7.9, "work-start"),
    (21.6, "idle-return"),
    (33.4, "short-break"),
    (61.3, "back-to-work"),
]


def mix(music_path):
    """Music bed + the app's chimes → one AAC track for both cuts."""
    inputs = ["-i", music_path]
    fc = []
    for i, (at, name) in enumerate(SOUND_CUES):
        inputs += ["-i", os.path.join(PROJ, "assets", "sounds", f"{name}.wav")]
        delay = int((INTRO + at) * 1000)
        fc.append(f"[{i + 1}:a]adelay={delay}|{delay},volume=1.15[c{i}]")
    chimes = "".join(f"[c{i}]" for i in range(len(SOUND_CUES)))
    fc.append(f"[0:a]volume=1.0[m]")
    fc.append(
        f"[m]{chimes}amix=inputs={len(SOUND_CUES) + 1}:normalize=0:dropout_transition=0,"
        # Social feeds normalise loudness; master to the usual -14 LUFS so the
        # track is not quietly buried under whatever plays before it.
        f"loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.97,atrim=0:{TOTAL},"
        f"aformat=sample_rates=48000:channel_layouts=stereo[aout]"
    )
    out = os.path.join(HERE, "build", "track.m4a")
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y"] + inputs
        + ["-filter_complex", ";".join(fc), "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", out],
        check=True,
    )
    return out


def remux(track):
    for src, dst in (
        ("build/silent.mp4", "Ferna-Pomoro-demo.mp4"),
        ("build-social/silent.mp4", "Ferna-Pomoro-demo-mobile.mp4"),
    ):
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", os.path.join(HERE, src), "-i", track,
             "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-shortest", "-movflags", "+faststart", os.path.join(HERE, dst)],
            check=True,
        )
        print("wrote", dst)


if __name__ == "__main__":
    print("synthesising…")
    music = build()
    track = mix(music)
    remux(track)
