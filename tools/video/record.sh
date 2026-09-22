#!/bin/bash
# Record the scripted demo from a virtual display.
set -e
DISP=:77
OUT=${1:-/home/claude/video/raw.mp4}
rm -f "$OUT"
Xvfb $DISP -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!
sleep 2

# A flat background so the desktop behind the app is not pure black.
DISPLAY=$DISP xsetroot -solid "#0b0d12" 2>/dev/null || true

DISPLAY=$DISP ffmpeg -loglevel error -y -f x11grab -draw_mouse 1 -framerate 30 \
  -video_size 1280x800 -i $DISP -c:v libx264 -preset veryfast -crf 18 \
  -pix_fmt yuv420p "$OUT" &
FF_PID=$!
sleep 1.5

cd /home/claude/pomora
DISPLAY=$DISP npx electron . --demo --no-sandbox 2>/dev/null | tee /home/claude/video/beats.txt
sleep 1

kill -INT $FF_PID 2>/dev/null || true
wait $FF_PID 2>/dev/null || true
kill $XVFB_PID 2>/dev/null || true
echo "recorded: $OUT"
