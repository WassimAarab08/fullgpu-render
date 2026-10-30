# Contributing

Thanks for helping make programmatic video rendering faster.

## Ground rules

- **Keep frames on the GPU.** Every change to the render path should say whether it adds a CPU round trip.
- **Tests first.** Add or change a test that shows the bug or the feature before the fix.
- **Measure.** If you touch the render path, include `tools/bench.mjs` numbers before and after
  (same machine, idle, `BENCH_ENGINES=0`, and check `nvidia-smi` for clock throttling).

## Setup

```bash
npm install
npm run media                      # synthetic inputs in media/ (needs ffmpeg)
npm test
cd native && cargo test --release  # add `-- --include-ignored` on a machine with an NVIDIA GPU and ffmpeg
```

## Repository layout

| Path | What |
|---|---|
| `scene/` | Scene model → per-frame draw lists (the engine input format) |
| `shaders/` | WGSL shared by WebGPU (browser) and wgpu (native) |
| `native/` | Rust engine: NVDEC → wgpu → NVENC |
| `browser/` | WebGPU + WebCodecs engine and its local server |
| `remotion-baseline/` | The same scene in Remotion, for comparison |
| `tools/` | Benchmark harness, output verifier, sample media |

Code comments are currently in Spanish; English is welcome in new code.
