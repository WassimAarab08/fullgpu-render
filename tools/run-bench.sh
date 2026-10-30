#!/usr/bin/env bash
# Batería completa del benchmark. Ejecutar desde gpu-video-poc/ con la máquina en reposo
# y sin renders de Remotion en curso. Resultados en out/bench/*.json.
set -u
cd "$(dirname "$0")/.."
node scene/scene.mjs > out/layout.json
REMOTION="node remotion-baseline/node_modules/@remotion/cli/remotion-cli.js render remotion-baseline/src/index.tsx Bench"
R_COMMON="--public-dir=media --codec=h264 --gl=angle --concurrency=8"
run() { echo "== $1"; node tools/bench.mjs "$@" > /dev/null 2>&1; tail -c 300 "out/bench/$1.json" | grep -o '"fps": [0-9.]*' ; }

# 1) Velocidad: solo nvidia-smi.
export BENCH_ENGINES=0
for i in 1 2 3; do
  run speed-a-hw-$i 1800 -- node browser/server.mjs --out=speed-a-hw-$i.mp4
  run speed-b-$i 1800 -- native/target/release/fullgpu-render out/layout.json . out/speed-b-$i.mp4
done
run speed-a-sw 1800 -- node browser/server.mjs --hw=prefer-software --out=speed-a-sw.mp4
run speed-remotion 1800 -- $REMOTION out/speed-remotion.mp4 $R_COMMON --crf=20
run speed-remotion-nvenc 1800 -- $REMOTION out/speed-remotion-nvenc.mp4 $R_COMMON --video-bitrate=8M --hardware-acceleration=required

# 2) Utilización: también contadores GPU Engine de Windows (ven la Intel).
export BENCH_ENGINES=1
run util-a-hw 1800 -- node browser/server.mjs --out=util-a-hw.mp4
run util-b 1800 -- native/target/release/fullgpu-render out/layout.json . out/util-b.mp4
run util-remotion 1800 -- $REMOTION out/util-remotion.mp4 $R_COMMON --crf=20
echo "== fin"
