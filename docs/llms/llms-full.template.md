# fullgpu-render {{VERSION}}: complete reference for LLMs and coding agents

> Generated from docs/llms/llms-full.template.md and the source code by `npm run llms`. Do not edit docs/llms-full.txt by hand.

fullgpu-render renders programmatic videos entirely on an NVIDIA GPU: clips are decoded with NVDEC, every frame is
composited with wgpu (WGSL shaders) and encoded with NVENC. There is no headless browser. You describe a video in one
of two ways:

1. **SDK composition** (`.mjs`): a function from frame number to a list of nodes (`rect`, `text`, `image`, `video`,
   `audio`, `group`, `sequence`). Smallest surface, every feature of the engine.
2. **Remotion project** (`.tsx`, `.jsx`, `.ts`, `.js`): the same entry file `npx remotion render` uses. React components
   are evaluated per frame by an own runtime and laid out with flexbox; a subset of HTML/CSS is supported (listed below).

Requirements: an NVIDIA GPU on Windows or Linux x64, `ffmpeg` with `h264_nvenc` and CUDA on the PATH, Node 22+.
`npx fullgpu doctor` checks all of it. The native engine downloads on first use (no Rust needed). If it cannot be
downloaded (no network, or a version without published binaries), set `FULLGPU_BIN` to an engine binary.

## Install

```bash
npm install github:WassimAarab08/fullgpu-render
npx fullgpu doctor
```

npm may warn that esbuild's install script is not allowed (`allow-scripts`). It is harmless: esbuild works without
it. A Remotion entry needs no `package.json`, `react`, `remotion` or `tsconfig` of its own; those imports are provided.

## CLI

```
{{CLI_USAGE}}
```

### JSON output (`--json`)

Every command prints exactly one JSON object on stdout. Engine logs go to stderr.

- `ok: true` plus the result, or `ok: false` plus `error` (a sentence that says what to change).
- `render`: `{ ok, command, out, composition, frames, durationSeconds, width, height, fps, compileSeconds, renderFps, totalSeconds, warnings }`
- `still`: `{ ok, command, composition, files: ["shot-0.png", ...], frames, warnings }`
- `compositions`: `{ ok, command, compositions: [{ id, width, height, fps, durationInFrames }] }`
- `check`: `{ ok, command, composition, frames, durationSeconds, maxDraws, missing, errors, warnings }`. `ok` is false when it would not
  render (missing media, too many draws in a frame); `warnings` are effects that will be skipped. If the engine is not
  available, `check` still runs with estimated text sizes and says so in a warning: line breaks may then differ.
- `doctor`: `{ ok, command, checks: [{ ok, label, fix, optional }] }`

Exit codes: 0 success, 1 failure (or `check` found errors), 2 wrong arguments.

## Workflow for agents

1. `npx fullgpu compositions <entry> --json` to learn ids, size and duration.
2. `npx fullgpu check <entry> [id] --json` before rendering. Fix every `errors` entry; read `warnings`, they name
   CSS or features the engine skips (rewrite those parts with supported features if they matter).
3. `npx fullgpu still <entry> [id] shot.png --frame 0,30,90 --json` and look at the PNGs. Choose frames where things
   happen (entrances, mid-animation, the end). This is the fast loop: a still takes about a second.
4. Change the code, repeat 2-3.
5. `npx fullgpu render <entry> [id] out.mp4 --json` once the stills look right.

Media paths (`src`, `staticFile("x.png")`) are relative to `--public-dir` (default `./public` for Remotion entries,
else the current directory). A missing file is a `check` error that names the folder it looked in.

## SDK compositions

```js
// video.mjs
import { composition, rect, text, image, video, audio, group, sequence, spring, interpolate, Easing } from "fullgpu-render";

export default composition({ width: 1920, height: 1080, fps: 30, durationInFrames: 150, background: "#0B1020" }, ({ frame, fps }) => {
  const pop = spring({ frame, fps, config: { damping: 12 } });
  return [
    rect({ x: 0, y: 0, width: 1920, height: 1080, gradient: { from: "#0B1020", to: "#1D3A8A", angle: 135 } }),
    group({ x: 960, y: 480, scale: 0.6 + 0.4 * pop, opacity: pop }, [
      text({ text: "Hello, GPU", x: 0, y: 0, size: 140, weight: 800, color: "#FFFFFF" }),
    ]),
    sequence({ from: 30 }, (f) =>
      text({ text: "rendered end to end on the GPU", x: 960, y: 640, size: 44, color: "#C9D4FF",
             opacity: interpolate(f, [0, 20], [0, 1], { extrapolateRight: "clamp" }) })),
  ];
});
```

- `composition(config, render)`: config `{ width, height, fps = 30, durationInFrames, background = "#000000" }`.
  `render({ frame, fps, width, height, durationInFrames })` returns a node, an array (nested arrays are fine) or a
  Promise of them. Falsy children (`null`, `false`, `""`, `0`) are ignored. Must be pure: same frame, same output.
- `rect({ x, y, width, height, radius, color | gradient: { from, to, angle }, shadow: { x, y, blur, color, clip }, border: { width, color }, opacity })`.
  `x, y` is the top-left corner. Colors are CSS strings (hex, `rgb()`, `rgba()`, basic names). Angles are CSS angles
  (`90` = left to right). The radius is clamped to half the shorter side. `shadow.clip: true` hides the shadow under the
  box like CSS; without it the shadow also shows under a translucent box (handy for glows). With `border` and no
  `color`/`gradient` only the border is drawn.
- `text({ text, x, y, size = 48, weight = 600, color = "#ffffff", font, align, maxWidth, lineHeight, textAlign, anchor, background, scale, opacity })`.
  `(x, y)` is the **center** of the text box, or the left edge with `align: "left"`. `font` is a family or a CSS family
  list (default Segoe UI); the font must be installed on the machine. `maxWidth` wraps lines; `textAlign`
  (`"left" | "center" | "right"`) aligns wrapped lines; `lineHeight` is in px. `anchor: "bottom"` makes `y` the bottom
  edge. `background: { color, padX, padY, radius }` draws a pill behind it. Bidi, Arabic and CJK work.
- `image({ src, x, y, width, height, radius, opacity })`: PNG, JPEG or WebP, stretched to the box.
- `video({ src, x, y, width, height, radius, from, durationInFrames, startFrom, playbackRate, fit, opacity })`:
  `from` is the start frame (relative to the enclosing `sequence`), `startFrom` is the offset into the file in
  **seconds**, `fit` is `"cover"` (default), `"contain"` or `"fill"`. Decoded with NVDEC at the size it is shown. The
  clip's own audio is not mixed.
- `audio({ src, from, startFrom, durationInSeconds })`: `startFrom` in seconds. All clips must come from **one file**.
- `group({ x, y, scale, opacity }, children)`: translates, scales (from the group origin) and fades a subtree.
- `sequence({ from, durationInFrames }, render)`: `render(localFrame)` runs only inside its span.
- `compile(comp, { mediaRoot, range })`: turns a composition into the engine's layout JSON (used by the CLI).
- Animation helpers with Remotion's signatures, checked value by value against Remotion: `interpolate(input,
  inputRange, outputRange, { easing, extrapolateLeft, extrapolateRight })`, `spring({ frame, fps, config: { damping,
  mass, stiffness, overshootClamping }, from, to, durationInFrames, delay, reverse })`, `measureSpring({ fps, config })`,
  `Easing` (linear, ease, quad, cubic, poly, sin, circle, exp, bezier, elastic, back, bounce, in/out/inOut),
  `interpolateColors(input, inputRange, colors)`.

## Remotion projects

```bash
npx fullgpu render src/index.tsx MyComposition out.mp4 --public-dir public --props '{"title":"Hi"}'
```

`react`, `react/jsx-runtime`, `remotion` and `@remotion/media` are replaced at bundle time (esbuild) by fullgpu-render's
own modules. Other packages bundle normally; other `@remotion/*` packages and `react-dom` are rejected with a clear error.

Exports of `remotion`: {{REMOTION_EXPORTS}}.

Exports of `react`: {{REACT_EXPORTS}}.

Semantics to keep in mind:

- Each frame is rendered from scratch. `useState` returns its initial value, `useRef` starts fresh, effects never run.
  Animate from `useCurrentFrame()`, as Remotion recommends anyway.
- `delayRender`/`continueRender` are accepted and do nothing: load data in `calculateMetadata` instead (it is awaited).
- `<Video>`/`<OffthreadVideo>`/`@remotion/media` `<Video>`: `trimBefore`/`trimAfter` (or `startFrom`/`endAt`) in
  frames, `playbackRate`, `objectFit` (`cover`, `contain` (the default), `fill`), `muted`. Give it a size, for example
  `style={{ width: "100%", height: "100%" }}`. Its audio track is not mixed: add an `<Audio>` with the same file.
- `<Audio>`: one source file per video; `volume` and `playbackRate` are ignored (with a warning).
- `<Img>`: stretched to its box (`objectFit` other than `fill` is ignored).
- `<Sequence>` wraps children in an `AbsoluteFill` unless `layout="none"`, like Remotion, and `useCurrentFrame()`
  inside it starts at 0 at the sequence's `from`. `useVideoConfig().durationInFrames` is the sequence's duration.

### CSS

Style properties the layout reads: {{CSS_PROPS}}.

- Values: numbers are px; strings may use `px`, `%`, `em`, `rem`. No `calc()`, `vw`, `vh`.
- Layout is flexbox (Yoga). `display: block` (the default) stacks children vertically and stretches them; `display:
  flex` defaults to `flexDirection: "row"` like the web. `position: absolute` is relative to the parent box;
  `left` + `right` (or `top` + `bottom`) without a size stretch the box between them, as in CSS.
- Browser defaults that apply: text is black, 16 px, `"Times New Roman", serif`, weight 400, `line-height: normal`;
  `h1`, `h2`, `h3`, `p`, `strong`, `b` have their usual sizes, weights and margins. Set `fontFamily` explicitly.
- Text: a paragraph is one run. Children like `<span>` or `<strong>` are merged into it and their own styles are not
  applied separately. `textTransform`, `textAlign`, `whiteSpace: "nowrap" | "pre"`, `lineHeight` (number, px or %).
  Line breaks follow CSS: a `
` in the text is a space unless `whiteSpace: "pre"`; `<br>` always breaks. Lines
  (wrapped or broken) are aligned with each other by `textAlign`.
- Paint: `background` / `backgroundColor` / `backgroundImage` with a color or a `linear-gradient(...)` (first and last
  stop), `border` (one width and color for all sides), `borderRadius` (one value, px or %), `boxShadow` (first shadow;
  no `inset`, no spread), `opacity`, `transform` with `translate`, `translateX/Y`, `translate3d` and uniform `scale`
  (rotation is not supported), `transformOrigin`, `overflow: "hidden"` (rounds children that fill the box; does not
  clip other content).
- Colors: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, basic names, `transparent`.

Not supported yet (reported as warnings by `check` and skipped): SVG, `<canvas>`, rotation, `filter`/blur, masks,
`clipPath`, `mixBlendMode`, `letterSpacing`, `textShadow`, italic, per-span styles inside a paragraph, `zIndex`
ordering (paint order is tree order), the audio of `<Video>`, audio volume, more than one audio file.

## Limits and pitfalls

- At most 512 draws per frame (a box with background, border and shadow is up to 3). `check` reports the maximum.
- Fonts come from the system. Use families that exist on the render machine, and give a fallback list.
- Output is H.264 (NVENC) MP4 at the composition's size and fps, with the mixed audio if there is any.
- Renders are deterministic: the same code, props and media give the same frames.
- When the GPU is missing or busy the engine fails with an error from wgpu or ffmpeg; run `npx fullgpu doctor`.
