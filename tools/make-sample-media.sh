#!/usr/bin/env bash
# Genera vídeos de entrada sintéticos en media/ (degradados animados de ffmpeg) para reproducir el benchmark sin grabaciones privadas.
# phone.mp4:  1080x2340 vertical, rango limitado (tv), 130 s
# tablet.mp4: 1600x1112 horizontal, rango completo (yuvj420p, pc), 100 s
# Ambos H.264 High con B-frames, 30 fps constantes y BT.709, como una grabación de pantalla típica.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media
common=(-c:v libx264 -preset veryfast -crf 23 -g 60 -bf 2 -colorspace bt709 -color_primaries bt709 -color_trc bt709)
ffmpeg -v error -y -f lavfi -i "gradients=size=1080x2340:rate=30:duration=130:c0=0x6a5acd:c1=0x1d9e75:c2=0xf2a623:c3=0xd4537e:nb_colors=4:type=spiral:speed=0.01" \
  "${common[@]}" -pix_fmt yuv420p -color_range tv media/phone.mp4
ffmpeg -v error -y -f lavfi -i "gradients=size=1600x1112:rate=30:duration=100:c0=0x185fa5:c1=0xd4537e:c2=0xfac775:c3=0x0f6e56:nb_colors=4:type=spiral:speed=0.03" \
  "${common[@]}" -pix_fmt yuvj420p -color_range pc media/tablet.mp4
ls -la media
