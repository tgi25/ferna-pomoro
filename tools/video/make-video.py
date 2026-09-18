#!/usr/bin/env python3
"""Turn the raw screen capture into the finished demo video.

Canvas is 1280x960: a brand bar on top, the untouched 1280x800 capture in the
middle (no rescaling, so the app stays pixel-sharp), and a caption band below.
Captions are timed from the beats the demo script printed while it ran.
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = "/home/claude/pomora"
OUT = os.path.join(HERE, "build")
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 960
BAR_H, VIDEO_H, CAP_H = 64, 800, 96
RAW = os.path.join(HERE, "raw2.mp4")
TRIM_START = 2.40          # first frame where the app window is up
TRIM_LEN = 65.0

BG = (11, 13, 18)
PANEL = (20, 22, 28)
TEXT = (231, 235, 243)
MUTED = (152, 162, 184)
RED = (224, 72, 63)
GREEN = (31, 157, 99)
BLUE = (59, 111, 225)

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font = lambda p, s: ImageFont.truetype(p, s)


def centred(d, text, f, y, fill, width=W, x0=0):
    w = d.textbbox((0, 0), text, font=f)[2]
    d.text((x0 + (width - w) / 2, y), text, font=f, fill=fill)
    return w


# ------------------------------------------------------------------ overlays

def brand_bar():
    """Always-on strip: icon, name, and what it is."""
    img = Image.new("RGBA", (W, BAR_H), PANEL + (255,))
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(PROJ, "assets", "icons", "pomora-128.png")).resize(
        (40, 40), Image.LANCZOS
    )
    img.paste(icon, (26, 12), icon)
    name_f = font(FB, 25)
    d.text((78, 12), "Ferna Pomoro", font=name_f, fill=TEXT)
    name_w = d.textbbox((0, 0), "Ferna Pomoro", font=name_f)[2]
    d.text((78 + name_w + 18, 20), "·  focus timer for Windows", font=font(F, 17), fill=MUTED)
    tag = "free · open source"
    w = d.textbbox((0, 0), tag, font=font(F, 17))[2]
    d.text((W - 30 - w, 20), tag, font=font(F, 17), fill=MUTED)
    d.line((0, BAR_H - 1, W, BAR_H - 1), fill=(44, 51, 66), width=2)
    path = os.path.join(OUT, "brandbar.png")
    img.save(path)
    return path


def caption(index, text, accent=TEXT):
    """One caption strip, sized to the band under the video."""
    img = Image.new("RGBA", (W, CAP_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(FB, 30)
    # Shrink to fit rather than wrap: captions are one line by design.
    while d.textbbox((0, 0), text, font=f)[2] > W - 120 and f.size > 18:
        f = font(FB, f.size - 1)
    centred(d, text, f, (CAP_H - f.size - 8) / 2, accent)
    path = os.path.join(OUT, f"cap{index:02d}.png")
    img.save(path)
    return path


# --------------------------------------------------------------------- cards

def gradient(w, h):
    base = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / h
        d.line(
            (0, y, w, y),
            fill=(
                int(11 + 9 * (1 - t)),
                int(13 + 11 * (1 - t)),
                int(18 + 20 * (1 - t)),
            ),
        )
    return base


def intro_card():
    img = gradient(W, H)
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(PROJ, "assets", "icons", "pomora-256.png")).resize(
        (190, 190), Image.LANCZOS
    )
    img.paste(icon, (int((W - 190) / 2), 210), icon)
    centred(d, "Ferna Pomoro", font(FB, 74), 430, TEXT)
    centred(d, "A Pomodoro timer that refuses to count", font(F, 32), 530, MUTED)
    centred(d, "time you weren't there.", font(F, 32), 574, MUTED)
    d.rounded_rectangle((460, 660, 820, 716), radius=28, fill=(31, 157, 99, 255))
    centred(d, "Free for Windows 10 / 11", font(FB, 24), 676, (255, 255, 255), 360, 460)
    path = os.path.join(OUT, "intro.png")
    img.save(path)
    return path


def outro_card():
    img = gradient(W, H)
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(PROJ, "assets", "icons", "pomora-256.png")).resize(
        (130, 130), Image.LANCZOS
    )
    img.paste(icon, (int((W - 130) / 2), 120), icon)
    centred(d, "Ferna Pomoro 1.1", font(FB, 58), 285, TEXT)

    lines = [
        ("Idle time is never counted as focus", RED),
        ("Break window you can close without skipping the break", GREEN),
        ("Add the sessions you forgot to track", BLUE),
        ("Work alerts, break alerts, taskbar progress", MUTED),
        ("Tasks, statistics, CSV export", MUTED),
    ]
    y = 400
    for text, colour in lines:
        d.ellipse((330, y + 12, 344, y + 26), fill=colour)
        d.text((368, y), text, font=font(F, 28), fill=TEXT if colour != MUTED else MUTED)
        y += 58

    centred(d, "No account. No subscription. Nothing leaves your computer.", font(F, 24), 730, MUTED)
    centred(d, "Built by Prof. TGI Fernando", font(FB, 26), 800, TEXT)
    path = os.path.join(OUT, "outro.png")
    img.save(path)
    return path


# ----------------------------------------------------------------- captions

# (start, end, text) in content time — seconds after TRIM_START.
CAPTIONS = [
    (0.3, 4.6, "Pick what you are working on"),
    (4.9, 7.6, "…and start the clock"),
    (7.9, 13.8, "25 minutes of focus   ·   sped up for this video"),
    (14.1, 16.4, "Then you walk away from the desk"),
    (16.7, 21.2, "Five minutes with no input: the clock rewinds to your last keystroke"),
    (21.5, 26.6, "Back at the keyboard — it asks what that gap was"),
    (26.9, 32.9, "Idle time removed. The pomodoro carries on where it stopped"),
    (33.3, 38.6, "Pomodoro done — the break window takes over the screen"),
    (38.9, 43.4, "Close it when you need the screen…"),
    (43.7, 45.9, "…and the break keeps running. Nothing is skipped"),
    (47.2, 52.1, "Forgot to start the timer? Add that time by hand"),
    (52.4, 56.0, "Back-dated to the day it happened, and marked “manual”"),
    (56.4, 60.9, "Honest statistics: idle time removed, manual entries tagged"),
    (61.2, 64.8, "A mini timer to keep on top while you work"),
]

# Sound cues from the app's own alert chimes, in content time.
SOUNDS = [
    (7.9, "work-start"),
    (21.6, "idle-return"),
    (33.4, "short-break"),
    (61.3, "back-to-work"),
]

INTRO_LEN = 3.6
OUTRO_LEN = 5.0


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stderr[-3000:])
        raise SystemExit(f"failed: {' '.join(cmd[:6])} …")


def main():
    bar = brand_bar()
    caps = [(s, e, caption(i, t)) for i, (s, e, t) in enumerate(CAPTIONS)]

    # ---- main body: capture on the canvas, brand bar, captions -------------
    inputs = ["-ss", str(TRIM_START), "-t", str(TRIM_LEN), "-i", RAW, "-i", bar]
    for _, _, path in caps:
        inputs += ["-i", path]

    fc = [
        f"color=c=0x0b0d12:s={W}x{H}:r=30[bgc]",
        f"[0:v]setpts=PTS-STARTPTS[v]",
        f"[bgc][v]overlay=0:{BAR_H}:shortest=1[b1]",
        f"[b1][1:v]overlay=0:0[b2]",
    ]
    last = "b2"
    for i, (s, e, _) in enumerate(caps):
        src = i + 2
        out = f"c{i}"
        fc.append(
            f"[{last}][{src}:v]overlay=0:{BAR_H + VIDEO_H}:"
            f"enable='between(t,{s},{e})'[{out}]"
        )
        last = out
    fc.append(f"[{last}]format=yuv420p[vout]")

    body = os.path.join(OUT, "body.mp4")
    run(
        ["ffmpeg", "-loglevel", "error", "-y"]
        + inputs
        + ["-filter_complex", ";".join(fc), "-map", "[vout]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-r", "30", body]
    )

    # ---- intro and outro ---------------------------------------------------
    for name, png, length in (("intro", intro_card(), INTRO_LEN), ("outro", outro_card(), OUTRO_LEN)):
        run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", png, "-t", str(length),
             "-vf", f"fade=t=in:st=0:d=0.4,fade=t=out:st={length-0.5}:d=0.5,format=yuv420p",
             "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-r", "30",
             os.path.join(OUT, f"{name}.mp4")])

    # ---- audio: the app's own chimes, placed on a silent bed ---------------
    total = INTRO_LEN + TRIM_LEN + OUTRO_LEN
    a_inputs = []
    a_fc = []
    for i, (t, name) in enumerate(SOUNDS):
        a_inputs += ["-i", os.path.join(PROJ, "assets", "sounds", f"{name}.wav")]
        delay = int((INTRO_LEN + t) * 1000)
        a_fc.append(f"[{i}:a]adelay={delay}|{delay},volume=0.75[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(SOUNDS)))
    a_fc.append(f"{mix}amix=inputs={len(SOUNDS)}:normalize=0,apad,atrim=0:{total},aformat=sample_rates=48000:channel_layouts=stereo[aout]")
    audio = os.path.join(OUT, "audio.m4a")
    run(["ffmpeg", "-loglevel", "error", "-y"] + a_inputs
        + ["-filter_complex", ";".join(a_fc), "-map", "[aout]", "-c:a", "aac", "-b:a", "128k", audio])

    # ---- concat and mux ----------------------------------------------------
    listing = os.path.join(OUT, "concat.txt")
    with open(listing, "w") as fh:
        for part in ("intro", "body", "outro"):
            fh.write(f"file '{os.path.join(OUT, part + '.mp4')}'\n")
    silent = os.path.join(OUT, "silent.mp4")
    run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
         "-c", "copy", silent])

    final = os.path.join(HERE, "Ferna-Pomoro-demo.mp4")
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", silent, "-i", audio,
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
         "-shortest", "-movflags", "+faststart", final])
    print("wrote", final)


if __name__ == "__main__":
    main()
