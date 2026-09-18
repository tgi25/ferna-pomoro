#!/usr/bin/env python3
"""Generate Pomora's alert sounds and application icons.

Everything the app ships is produced here, so the assets can be rebuilt or
retuned without hunting for stock files: `python3 tools/make-assets.py`.
"""
import math
import os
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOUND_DIR = os.path.join(ROOT, "assets", "sounds")
ICON_DIR = os.path.join(ROOT, "assets", "icons")
BUILD_DIR = os.path.join(ROOT, "build")
RATE = 44100


# --------------------------------------------------------------------- sound

def tone(freq, dur, amp=0.5, decay=6.0, harmonics=(1.0, 0.32, 0.12), attack=0.004):
    """One struck-bell note: a few harmonics under an exponential decay."""
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-decay * t)
        if t < attack:                      # short fade-in kills the click
            env *= t / attack
        s = 0.0
        for k, level in enumerate(harmonics, start=1):
            s += level * math.sin(2 * math.pi * freq * k * t)
        s /= sum(harmonics)
        out.append(amp * env * s)
    return out


def silence(dur):
    return [0.0] * int(RATE * dur)


def sequence(parts):
    """Overlap notes by summing them onto a shared timeline."""
    length = max(offset + len(samples) for offset, samples in parts)
    buf = [0.0] * length
    for offset, samples in parts:
        for i, s in enumerate(samples):
            buf[offset + i] += s
    return buf


def at(seconds, samples):
    return (int(seconds * RATE), samples)


def write_wav(name, samples):
    os.makedirs(SOUND_DIR, exist_ok=True)
    peak = max(0.0001, max(abs(s) for s in samples))
    gain = 0.86 / peak if peak > 0.86 else 1.0
    frames = b"".join(
        struct.pack("<h", max(-32767, min(32767, int(s * gain * 32767)))) for s in samples
    )
    path = os.path.join(SOUND_DIR, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)
    print(f"  {name}.wav  {len(frames)/1024:6.1f} KB")


# Note frequencies
C5, D5, E5, F5, G5, A5, B5, C6, E6, G6 = (
    523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50, 1318.51, 1567.98
)


def build_sounds():
    print("sounds:")
    # Work: a firm, bright two-note call to attention (fifth up).
    write_wav("work-start", sequence([
        at(0.00, tone(C5, 1.1, 0.55, decay=5.0)),
        at(0.14, tone(G5, 1.3, 0.50, decay=4.2)),
        at(0.30, tone(C6, 1.4, 0.30, decay=3.6, harmonics=(1.0, 0.2))),
    ]))

    # Short break: soft, descending, marimba-like — an exhale, not an alarm.
    write_wav("short-break", sequence([
        at(0.00, tone(G5, 0.9, 0.42, decay=7.0, harmonics=(1.0, 0.18, 0.05))),
        at(0.16, tone(E5, 1.1, 0.40, decay=6.0, harmonics=(1.0, 0.18, 0.05))),
    ]))

    # Long break: three warm descending tones, slower and roomier.
    write_wav("long-break", sequence([
        at(0.00, tone(G5, 1.3, 0.40, decay=4.0, harmonics=(1.0, 0.25, 0.08))),
        at(0.26, tone(E5, 1.4, 0.38, decay=3.6, harmonics=(1.0, 0.25, 0.08))),
        at(0.52, tone(C5, 1.9, 0.42, decay=2.6, harmonics=(1.0, 0.3, 0.12))),
    ]))

    # Back to work after a break: a rising arpeggio that lifts.
    write_wav("back-to-work", sequence([
        at(0.00, tone(E5, 0.7, 0.40, decay=7.5)),
        at(0.11, tone(G5, 0.7, 0.42, decay=7.0)),
        at(0.22, tone(C6, 1.2, 0.48, decay=4.5)),
        at(0.34, tone(E6, 1.2, 0.26, decay=4.0, harmonics=(1.0, 0.15))),
    ]))

    # Returning from idle: a quiet, questioning blip.
    write_wav("idle-return", sequence([
        at(0.00, tone(A5, 0.5, 0.30, decay=11.0, harmonics=(1.0, 0.1))),
        at(0.13, tone(F5, 0.7, 0.28, decay=9.0, harmonics=(1.0, 0.1))),
    ]))

    # Tick: a dry click for the optional ticking clock.
    write_wav("tick", tone(2200, 0.028, 0.16, decay=150.0, harmonics=(1.0,), attack=0.0008))

    # Goal reached: a small fanfare.
    write_wav("goal", sequence([
        at(0.00, tone(C5, 0.6, 0.34, decay=8.0)),
        at(0.09, tone(E5, 0.6, 0.34, decay=8.0)),
        at(0.18, tone(G5, 0.8, 0.38, decay=6.5)),
        at(0.28, tone(C6, 1.4, 0.44, decay=4.0)),
        at(0.40, tone(G6, 1.2, 0.20, decay=4.0, harmonics=(1.0, 0.12))),
    ]))


# ---------------------------------------------------------------------- icon

SOURCE_ICON = os.path.join(ROOT, "assets", "brand", "source-icon.png")


def build_icons():
    """Derive every icon size, and the .ico, from the supplied artwork."""
    from PIL import Image, ImageFilter

    print("icons:")
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)

    src = Image.open(SOURCE_ICON).convert("RGBA")
    if src.size[0] != src.size[1]:                 # square it, centred
        side = max(src.size)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(src, ((side - src.size[0]) // 2, (side - src.size[1]) // 2), src)
        src = square

    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = {}
    for size in sizes:
        if size == src.size[0]:
            img = src.copy()
        elif size > src.size[0]:
            # Upscaling past the source: resample smoothly, then restore some
            # edge definition so the large tile does not look blurred.
            img = src.resize((size, size), Image.LANCZOS)
            img = img.filter(ImageFilter.UnsharpMask(radius=1.6, percent=70, threshold=2))
        else:
            img = src.resize((size, size), Image.LANCZOS)
        images[size] = img
        img.save(os.path.join(ICON_DIR, f"pomora-{size}.png"))
        print(f"  pomora-{size}.png")

    images[256].save(os.path.join(ICON_DIR, "pomora.png"))
    images[256].save(
        os.path.join(BUILD_DIR, "icon.ico"),
        format="ICO",
        sizes=[(s, s) for s in sizes],
    )
    print("  build/icon.ico")


def build_legacy_tomato_icon():
    """The original drawn tomato, kept for reference. Not used by the app."""
    from PIL import Image, ImageDraw, ImageFilter

    SS = 8  # supersampling factor for clean edges

    def draw(size):
        s = size * SS
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pad = s * 0.055
        body = (pad, s * 0.20, s - pad, s - pad)

        # Tomato body, with soft shading blurred in so there is no hard seam.
        d.ellipse(body, fill=(224, 72, 63, 255))

        shade = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(shade).ellipse(
            (pad * 0.6, s * 0.56, s - pad * 0.6, s + s * 0.10), fill=(142, 34, 30, 150)
        )
        shade = shade.filter(ImageFilter.GaussianBlur(s * 0.055))
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).ellipse(body, fill=255)
        img.paste(Image.alpha_composite(img, shade), (0, 0), mask)

        gloss = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(gloss).ellipse(
            (s * 0.26, s * 0.31, s * 0.43, s * 0.42), fill=(255, 255, 255, 96)
        )
        gloss = gloss.filter(ImageFilter.GaussianBlur(s * 0.022))
        img = Image.alpha_composite(img, gloss)
        d = ImageDraw.Draw(img)

        # Leaves and stalk.
        green = (46, 160, 96, 255)
        cx = s / 2
        for dx, dy in ((-0.18, 0.0), (0.18, 0.0), (0.0, -0.03)):
            d.ellipse(
                (
                    cx + dx * s - s * 0.13,
                    s * 0.16 + dy * s,
                    cx + dx * s + s * 0.13,
                    s * 0.16 + dy * s + s * 0.11,
                ),
                fill=green,
            )
        d.rounded_rectangle(
            (cx - s * 0.028, s * 0.06, cx + s * 0.028, s * 0.21),
            radius=s * 0.028,
            fill=(38, 132, 79, 255),
        )

        # Clock hands, the "this is a timer" cue.
        if size >= 32:
            w = max(2, int(s * 0.035))
            ccx, ccy = cx, s * 0.615
            d.line((ccx, ccy, ccx, ccy - s * 0.20), fill=(255, 255, 255, 235), width=w)
            d.line((ccx, ccy, ccx + s * 0.15, ccy + s * 0.05), fill=(255, 255, 255, 235), width=w)
            d.ellipse(
                (ccx - w * 0.9, ccy - w * 0.9, ccx + w * 0.9, ccy + w * 0.9),
                fill=(255, 255, 255, 250),
            )

        return img.resize((size, size), Image.LANCZOS)

    return draw


if __name__ == "__main__":
    build_sounds()
    build_icons()
    print("done")
