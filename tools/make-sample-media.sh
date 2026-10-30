#!/usr/bin/env bash
# Generates synthetic input videos in media/ so the benchmark is reproducible without private footage.
# phone.mp4:  1080x2340 portrait, limited range (tv), 130 s
# tablet.mp4: 1600x1112 landscape, full range (yuvj420p, pc), 100 s
# Both H.264 High with B-frames, 30 fps CFR, BT.709, like typical screen recordings.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media
common=(-c:v libx264 -preset veryfast -crf 23 -g 60 -bf 2 -colorspace bt709 -color_primaries bt709 -color_trc bt709)
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1080x2340:rate=30:duration=130" \
  "${common[@]}" -pix_fmt yuv420p -color_range tv media/phone.mp4
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1600x1112:rate=30:duration=100" \
  "${common[@]}" -pix_fmt yuvj420p -color_range pc media/tablet.mp4
ls -la media
