#!/usr/bin/env python3
"""A 4:5 cut of the same take, for the Facebook mobile feed.

1080x1350: a header with the icon and name, the app capture scaled to the full
width, a large caption band under it, and a standing footer. Same footage, same
captions, bigger type.
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

import importlib.util

spec = importlib.util.spec_from_file_location(
    "landscape", os.path.join(os.path.dirname(os.path.abspath(__file__)), "make-video.py")
)
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build-social")
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1350
VID_W, VID_H = 1080, 675          # 1280x800 scaled by 0.84375
VID_Y = 330
CAP_Y = 1040
F, FB = L.F, L.FB
font = L.font


def chrome():
    """Header, footer and background — everything that never changes."""
    img = L.gradient(W, H)
    d = ImageDraw.Draw(img)

    icon = Image.open(os.path.join(L.PROJ, "assets", "icons", "pomora-256.png")).resize(
        (96, 96), Image.LANCZOS
    )
    img.paste(icon, (int((W - 96) / 2), 60), icon)
    L.centred(d, "Ferna Pomoro", font(FB, 52), 176, L.TEXT, W)
    L.centred(d, "a focus timer that won't count time you weren't there", font(F, 24), 244, L.MUTED, W)

    # A frame around the video area so the capture sits on something.
    d.rounded_rectangle(
        (0, VID_Y - 10, W, VID_Y + VID_H + 10), radius=18, fill=(16, 18, 24)
    )

    d.rounded_rectangle((330, 1244, 750, 1300), radius=28, fill=L.GREEN)
    L.centred(d, "Free for Windows 10 / 11", font(FB, 26), 1258, (255, 255, 255), 420, 330)

    path = os.path.join(OUT, "chrome.png")
    img.save(path)
    return path


def caption(index, text):
    """Two-line captions, wrapped by width rather than shrunk to nothing."""
    img = Image.new("RGBA", (W, 180), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(FB, 40)
    words = text.split()
    lines, line = [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if d.textbbox((0, 0), trial, font=f)[2] > W - 90 and line:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    while len(lines) > 2 and f.size > 26:      # tighten rather than spill
        f = font(FB, f.size - 2)
        lines, line = [], ""
        for word in words:
            trial = f"{line} {word}".strip()
            if d.textbbox((0, 0), trial, font=f)[2] > W - 90 and line:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)

    y = (180 - len(lines) * (f.size + 12)) / 2
    for ln in lines:
        L.centred(d, ln, f, y, L.TEXT, W)
        y += f.size + 12
    path = os.path.join(OUT, f"cap{index:02d}.png")
    img.save(path)
    return path


def card(kind):
    img = L.gradient(W, H)
    d = ImageDraw.Draw(img)
    if kind == "intro":
        icon = Image.open(os.path.join(L.PROJ, "assets", "icons", "pomora-256.png")).resize(
            (230, 230), Image.LANCZOS
        )
        img.paste(icon, (int((W - 230) / 2), 330), icon)
        L.centred(d, "Ferna Pomoro", font(FB, 76), 610, L.TEXT, W)
        L.centred(d, "A Pomodoro timer that refuses", font(F, 34), 730, L.MUTED, W)
        L.centred(d, "to count time you weren't there.", font(F, 34), 778, L.MUTED, W)
        d.rounded_rectangle((330, 880, 750, 940), radius=30, fill=L.GREEN)
        L.centred(d, "Free for Windows 10 / 11", font(FB, 26), 897, (255, 255, 255), 420, 330)
    else:
        icon = Image.open(os.path.join(L.PROJ, "assets", "icons", "pomora-256.png")).resize(
            (150, 150), Image.LANCZOS
        )
        img.paste(icon, (int((W - 150) / 2), 190), icon)
        L.centred(d, "Ferna Pomoro 1.1", font(FB, 60), 380, L.TEXT, W)
        lines = [
            ("Idle time is never counted as focus", L.RED),
            ("A break window you can close", L.GREEN),
            ("without skipping the break", L.GREEN),
            ("Add the sessions you forgot", L.BLUE),
            ("Alerts, taskbar progress, statistics", L.MUTED),
        ]
        y = 520
        for text, colour in lines:
            d.ellipse((150, y + 14, 164, y + 28), fill=colour)
            d.text((192, y), text, font=font(F, 30), fill=L.TEXT if colour != L.MUTED else L.MUTED)
            y += 64
        L.centred(d, "No account. No subscription.", font(F, 26), 900, L.MUTED, W)
        L.centred(d, "Nothing leaves your computer.", font(F, 26), 940, L.MUTED, W)
        L.centred(d, "Built by Prof. TGI Fernando", font(FB, 28), 1030, L.TEXT, W)
    path = os.path.join(OUT, f"{kind}.png")
    img.save(path)
    return path


def main():
    base = chrome()
    caps = [(s, e, caption(i, t)) for i, (s, e, t) in enumerate(L.CAPTIONS)]

    inputs = ["-ss", str(L.TRIM_START), "-t", str(L.TRIM_LEN), "-i", L.RAW, "-i", base]
    for _, _, p in caps:
        inputs += ["-i", p]

    fc = [
        f"[1:v]loop=loop=-1:size=1:start=0,setpts=N/30/TB[bg]",
        f"[0:v]scale={VID_W}:{VID_H},setpts=PTS-STARTPTS[v]",
        f"[bg][v]overlay=0:{VID_Y}:shortest=1[b1]",
    ]
    last = "b1"
    for i, (s, e, _) in enumerate(caps):
        fc.append(
            f"[{last}][{i + 2}:v]overlay=0:{CAP_Y}:enable='between(t,{s},{e})'[c{i}]"
        )
        last = f"c{i}"
    fc.append(f"[{last}]format=yuv420p,fps=30[vout]")

    body = os.path.join(OUT, "body.mp4")
    L.run(["ffmpeg", "-loglevel", "error", "-y"] + inputs
          + ["-filter_complex", ";".join(fc), "-map", "[vout]",
             "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-r", "30", body])

    for kind, length in (("intro", L.INTRO_LEN), ("outro", L.OUTRO_LEN)):
        L.run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", card(kind),
               "-t", str(length), "-vf",
               f"fade=t=in:st=0:d=0.4,fade=t=out:st={length-0.5}:d=0.5,format=yuv420p",
               "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-r", "30",
               os.path.join(OUT, f"{kind}.mp4")])

    listing = os.path.join(OUT, "concat.txt")
    with open(listing, "w") as fh:
        for part in ("intro", "body", "outro"):
            fh.write(f"file '{os.path.join(OUT, part + '.mp4')}'\n")
    silent = os.path.join(OUT, "silent.mp4")
    L.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
           "-i", listing, "-c", "copy", silent])

    final = os.path.join(HERE, "Ferna-Pomoro-demo-mobile.mp4")
    L.run(["ffmpeg", "-loglevel", "error", "-y", "-i", silent,
           "-i", os.path.join(HERE, "build", "audio.m4a"),
           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
           "-shortest", "-movflags", "+faststart", final])
    print("wrote", final)


if __name__ == "__main__":
    main()
