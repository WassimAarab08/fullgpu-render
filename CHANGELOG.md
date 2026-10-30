# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-30

### Added

- Scene model (`scene/scene.mjs`) that compiles to per-frame draw lists, the engine input format.
- Native engine (`native/`): ffmpeg NVDEC + `scale_cuda` → wgpu with shared WGSL → RGB→NV12 on the GPU → ffmpeg NVENC.
  One decoder per clip with its own playback rate, text with cosmic-text (bidi, Arabic, CJK, wrapping) and
  voice-over clips mixed and muxed in the encoder.
- Browser engine (`browser/`): WebCodecs decode → `importExternalTexture` → WebGPU → WebCodecs encode.
- Remotion baseline with the same scene, benchmark harness (`tools/bench.mjs`, `tools/run-bench.sh`) and
  synthetic test media (`tools/make-sample-media.sh`).
