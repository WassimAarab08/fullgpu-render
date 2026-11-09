---
name: fullgpu-render
description: Make, edit and render videos in code with fullgpu-render, which renders entirely on an NVIDIA GPU with no headless browser. Use when the user wants a programmatic video (promo, explainer, social clip, animated chart, captions), wants to render a Remotion project faster or without Chrome, or mentions fullgpu-render or the `fullgpu` CLI.
---

# Making videos with fullgpu-render

fullgpu-render turns code into an MP4: clips are decoded with NVDEC, frames are composited on the GPU and encoded with
NVENC. You write the video either as an **SDK composition** (`.mjs`) or as a **Remotion project** (`.tsx`), and drive
everything through the `fullgpu` CLI with `--json`.

The complete reference (every SDK option, the supported Remotion API and CSS, the JSON shapes) is
`node_modules/fullgpu-render/docs/llms-full.txt` once installed, or
https://raw.githubusercontent.com/WassimAarab08/fullgpu-render/main/docs/llms-full.txt. Read it before writing anything
beyond the templates below.

## 1. Set up and check the machine

```bash
npm install github:WassimAarab08/fullgpu-render
npx fullgpu doctor --json
```

`doctor` must report `ok: true`: it needs an NVIDIA GPU (Windows or Linux x64), `ffmpeg` with `h264_nvenc` and CUDA on
the PATH, and Node 22+. If a check fails, tell the user its `fix` text; do not try to render without a GPU. The engine
binary downloads on the first render.

## 2. Choose the format

- The user already has a Remotion project, or wants React components: keep the `.tsx`, render it as is.
- Otherwise prefer the **SDK**: smaller surface, every engine feature, nothing unsupported to trip over.

## 3. The loop: check, look, fix

Never render the whole video blind. Work in this order and read every JSON result:

1. `npx fullgpu compositions <entry> --json`: ids, size, fps, duration.
2. `npx fullgpu check <entry> [id] --json`: compiles every frame without rendering.
   - `errors` (missing media, too many draws in a frame) must be fixed: `ok` is false and it would not render.
   - `warnings` name features that will be skipped (rotation, filters, SVG, per-span text styles...). If the effect
     matters, rebuild it with supported features instead of leaving it out silently.
3. `npx fullgpu still <entry> [id] shots/frame.png --frame 0,30,75,140 --json`, then **open the PNGs and look at them**.
   Pick frames where something happens: the first frame, mid-entrance, the busiest moment, the last frame. Check
   overlap, cut-off text, contrast, alignment and that every element is where you meant it.
4. Fix and repeat 2-3. A still takes about a second.
5. `npx fullgpu render <entry> [id] out.mp4 --json` and report `out`, `durationSeconds` and `renderFps` to the user.

Media paths and `staticFile()` resolve from `--public-dir` (default `./public` for Remotion entries, else the current
directory). Pass `--props '<json>'` for Remotion input props.

## 4. Templates

SDK composition (`video.mjs`), coordinates in px, text positioned by its **center**:

```js
import { composition, rect, text, image, group, sequence, spring, interpolate } from "fullgpu-render";

export default composition({ width: 1920, height: 1080, fps: 30, durationInFrames: 150 }, ({ frame, fps }) => {
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return [
    rect({ x: 0, y: 0, width: 1920, height: 1080, gradient: { from: "#0B1020", to: "#1D3A8A", angle: 135 } }),
    group({ x: 960, y: 500 - 40 * (1 - enter), opacity: enter }, [
      text({ text: "Your headline", x: 0, y: 0, size: 110, weight: 800, color: "#FFFFFF", font: "Inter, Segoe UI, sans-serif" }),
    ]),
    sequence({ from: 25 }, (f) => [
      rect({ x: 660, y: 620, width: 600, height: 84, radius: 42, color: "#FFFFFF", opacity: interpolate(f, [0, 15], [0, 1], { extrapolateRight: "clamp" }) }),
      text({ text: "Call to action", x: 960, y: 662, size: 36, weight: 700, color: "#0B1020" }),
    ]),
  ];
});
```

Remotion component (`src/index.tsx`), standard Remotion code:

```tsx
import React from "react";
import { AbsoluteFill, Composition, registerRoot, spring, useCurrentFrame, useVideoConfig } from "remotion";

const Title: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: "#0B1020", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ margin: 0, fontFamily: "Inter, Segoe UI, sans-serif", fontSize: 110, color: "white", opacity: s }}>{text}</h1>
    </AbsoluteFill>
  );
};

registerRoot(() => <Composition id="Title" component={Title} durationInFrames={120} fps={30} width={1920} height={1080} defaultProps={{ text: "Hello" }} />);
```

## 5. Rules that avoid most mistakes

- Animate only from the frame (`useCurrentFrame()`, `frame` in the SDK). Every frame is rendered on its own: state,
  refs and effects do not carry over between frames.
- Set `fontFamily` (React) or `font` (SDK) to fonts installed on the machine, with a fallback list. React text without
  a family renders in Times New Roman, as in a browser.
- Give `<Video>` and `<Img>` a size. `<Video>` defaults to `objectFit: "contain"`; use `cover` for screens.
- Audio: one source file per video. A `<Video>`'s own sound is not mixed: add an `<Audio>` with the same file.
- No rotation, SVG, blur/filters, masks or per-span text styles yet. Use `scale`, `translate`, opacity, gradients,
  rounded boxes, borders and shadows instead.
- At most 512 draws per frame; `check` reports `maxDraws`.
- Keep paragraphs as one text run; style a different word by making it a separate element.

## 6. When something fails

| Symptom | What to do |
|---|---|
| `missing media: x.mp4 (looked in ...)` | Point `--public-dir` at the folder that has it, or fix the path. |
| `The entry registers several compositions` | Pass the composition id. |
| `... is not supported yet by fullgpu-render` on bundle | That `@remotion/*` package or `react-dom` is not available: remove it or replace it. |
| `frame N is outside the composition` | Frames go from 0 to `durationInFrames - 1`. |
| `Could not download the engine for vX (HTTP 404)` | No binaries for that version or no network: set `FULLGPU_BIN` to an engine binary. |
| `text sizes are estimated ...` warning from `check` | The engine was not available; line breaks may differ. Use `still` to confirm. |
| Centered lines are not centered | Use `<br>` or `whiteSpace: "pre"` for line breaks; a plain `
` is a space, as in CSS. |
| `doctor` fails on NVENC or CUDA | Install an ffmpeg build with NVENC and CUDA (on Windows: gyan.dev "full"). |
| Text looks different from the browser | Check the font is installed; compare with a still. |
