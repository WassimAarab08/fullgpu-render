// Launch video (4:5, for social feeds), rendered with fullgpu-render itself.
// It plays the other examples inside cards, so render them first: npm run examples
// Render: node sdk/render.mjs examples/launch-video.mjs out/launch-video.mp4
import { composition, rect, text, image, video, group, sequence, spring, interpolate, Easing } from "../sdk/index.mjs";

const W = 1080;
const H = 1350;
const FPS = 30;
const CX = W / 2;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const MINT = "#7CF3CF";
const CORAL = "#F0805F";

// A scene that fades in and out over its own time range.
const scene = (from, durationInFrames, render) =>
  sequence({ from, durationInFrames }, (f) => {
    const o = Math.min(interpolate(f, [0, 10], [0, 1], clamp), interpolate(f, [durationInFrames - 10, durationInFrames], [1, 0], clamp));
    return group({ opacity: o }, render(f));
  });
const pop = (f, delay, config = { damping: 12, stiffness: 140 }) => spring({ frame: f, fps: FPS, delay, config });
const rise = (f, delay) => {
  const s = pop(f, delay, { damping: 15 });
  return { y: (1 - s) * 40, opacity: s };
};

const hook = (f) => {
  const a = rise(f, 4);
  const b = pop(f, 40);
  return [
    text({ text: "Rendering a 4-minute video", x: CX, y: 380, size: 46, weight: 600, color: "#C9C6F5", opacity: a.opacity }),
    group({ y: a.y, opacity: a.opacity }, [
      text({ text: "Remotion", x: CX, y: 520, size: 64, weight: 700, color: "#FFFFFF" }),
      text({ text: "10 min", x: CX, y: 640, size: 150, weight: 900, color: CORAL }),
    ]),
    group({ x: CX, y: 880, scale: 0.5 + 0.5 * b, opacity: b }, [
      text({ text: "On the GPU", x: 0, y: -80, size: 64, weight: 700, color: "#FFFFFF" }),
      text({ text: "43 s", x: 0, y: 50, size: 190, weight: 900, color: MINT }),
    ]),
  ];
};

const ROWS = [
  { label: "Remotion", seconds: 204.1, color: "#E2603E" },
  { label: "Remotion + NVENC", seconds: 172.8, color: "#F0997B" },
  { label: "fullgpu · browser", seconds: 13.2, color: "#7CF3CF" },
  { label: "fullgpu · native", seconds: 8.7, color: "#14B88A" },
];
const bars = (f) => {
  const t = rise(f, 0);
  const punch = pop(f, 105, { damping: 9, stiffness: 120 });
  return [
    group({ y: t.y, opacity: t.opacity }, [
      text({ text: "Same 60-second scene.", x: CX, y: 220, size: 60, weight: 800, color: "#FFFFFF" }),
      text({ text: "Same laptop. Seconds to render.", x: CX, y: 290, size: 36, weight: 500, color: "#9C98D9" }),
    ]),
    ...ROWS.map((row, i) => {
      const y = 400 + i * 150;
      const g = spring({ frame: f, fps: FPS, delay: 15 + i * 12, config: { damping: 18, stiffness: 90 } });
      const w = Math.max(20, 900 * (row.seconds / 204.1) * g);
      return group({ opacity: interpolate(f, [10 + i * 12, 22 + i * 12], [0, 1], clamp) }, [
        text({ text: row.label, x: CX, y, size: 34, weight: 800, color: "#FFFFFF" }),
        rect({ x: 90, y: y + 36, width: 900, height: 64, radius: 16, color: "rgba(255,255,255,0.06)" }),
        rect({ x: 90, y: y + 36, width: w, height: 64, radius: 16, color: row.color }),
        text({ text: `${(row.seconds * g).toFixed(1)} s`, x: Math.min(90 + w + 80, 920), y: y + 68, size: 30, weight: 800, color: "#FFFFFF" }),
      ]);
    }),
    group({ x: CX, y: 1130, scale: 0.4 + 0.6 * punch, opacity: Math.min(1, punch * 1.5) }, [
      rect({ x: -330, y: -78, width: 660, height: 156, radius: 40, gradient: { from: "#14B88A", to: "#5B4BDB", angle: 120 }, shadow: { y: 18, blur: 50, color: "rgba(20,184,138,0.5)" } }),
      text({ text: "23×", x: -190, y: 0, size: 104, weight: 900, color: "#FFFFFF" }),
      text({ text: "faster", x: 120, y: 0, size: 64, weight: 800, color: "#E9FBF5" }),
    ]),
  ];
};

const card = (f, delay, box, clip) => {
  const s = pop(f, delay, { damping: 14 });
  const [x, y, w, h] = box;
  return group({ x: x + w / 2, y: y + h / 2 + (1 - s) * 60, scale: 0.85 + 0.15 * s, opacity: s }, [
    rect({ x: -w / 2, y: -h / 2, width: w, height: h, radius: 28, color: "#000000", shadow: { y: 24, blur: 60, color: "rgba(0,0,0,0.5)" } }),
    video({ ...clip, x: -w / 2, y: -h / 2, width: w, height: h, radius: 28 }),
  ]);
};
const gallery = (f) => {
  const t = rise(f, 0);
  return [
    group({ y: t.y, opacity: t.opacity }, [
      text({ text: "Write videos in code.", x: CX, y: 170, size: 66, weight: 900, color: "#FFFFFF" }),
      text({ text: "spring() · interpolate() · sequences · video · text", x: CX, y: 240, size: 30, weight: 500, color: MINT }),
    ]),
    card(f, 6, [60, 310, 960, 540], { src: "out/app-promo.mp4", startFrom: 1.2, playbackRate: 0.8, fit: "cover" }),
    card(f, 16, [60, 890, 280, 400], { src: "out/social-vertical.mp4", startFrom: 0.6, fit: "cover" }),
    card(f, 24, [370, 890, 650, 400], { src: "out/multilingual-titles.mp4", startFrom: 0.8, fit: "cover" }),
  ];
};

const STEPS = [
  { name: "NVDEC", detail: "decode clips on the GPU" },
  { name: "wgpu", detail: "compose with WGSL shaders" },
  { name: "NVENC", detail: "encode on the GPU" },
];
const pipeline = (f) => {
  const t = rise(f, 0);
  const tag = pop(f, 70, { damping: 14 });
  return [
    group({ y: t.y, opacity: t.opacity }, [
      text({ text: "Every frame stays", x: CX, y: 220, size: 66, weight: 900, color: "#FFFFFF" }),
      text({ text: "on the GPU.", x: CX, y: 300, size: 66, weight: 900, color: MINT }),
    ]),
    ...STEPS.flatMap((s, i) => {
      const p = pop(f, 12 + i * 14);
      const y = 470 + i * 210;
      return [
        i > 0 && rect({ x: CX - 4, y: y - 104, width: 8, height: 46 * p, radius: 4, color: "rgba(124,243,207,0.6)" }),
        group({ x: CX, y, scale: 0.7 + 0.3 * p, opacity: p }, [
          rect({ x: -330, y: -64, width: 660, height: 128, radius: 30, gradient: { from: "rgba(20,184,138,0.9)", to: "rgba(91,75,219,0.9)", angle: 100 } }),
          text({ text: s.name, x: 0, y: -18, size: 52, weight: 900, color: "#FFFFFF" }),
          text({ text: s.detail, x: 0, y: 34, size: 28, weight: 600, color: "#E9FBF5" }),
        ]),
      ];
    }),
    text({ text: "No browser. No screenshots. No CPU encode.", x: CX, y: 1180, size: 36, weight: 700, color: "#FFFFFF", opacity: tag }),
  ];
};

const outro = (f) => {
  const l = pop(f, 0, { damping: 10, stiffness: 120 });
  const r = rise(f, 14);
  const url = pop(f, 30);
  return [
    group({ x: CX, y: 440, scale: 0.5 + 0.5 * l, opacity: l }, [
      image({ src: "docs/logo.png", x: -120, y: -120, width: 240, height: 240, radius: 54 }),
    ]),
    group({ y: r.y, opacity: r.opacity }, [
      text({ text: "fullgpu-render", x: CX, y: 660, size: 92, weight: 900, color: "#FFFFFF" }),
      text({ text: "Open source · MIT / Apache-2.0", x: CX, y: 750, size: 38, weight: 600, color: "#C9C6F5" }),
      text({ text: "This video was rendered with it.", x: CX, y: 830, size: 38, weight: 600, color: MINT }),
    ]),
    group({ x: CX, y: 1000, scale: 0.8 + 0.2 * url, opacity: url }, [
      text({ text: "github.com/WassimAarab08/fullgpu-render", x: 0, y: 0, size: 36, weight: 800, color: "#0B0F24", background: { color: MINT, padX: 40, padY: 22, radius: 44 } }),
    ]),
  ];
};

export default composition({ width: W, height: H, fps: FPS, durationInFrames: 720, background: "#0B0F24" }, ({ frame }) => {
  const drift = Math.sin(frame / 50);
  return [
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: "#0B0F24", to: "#24135F", angle: 150 + frame * 0.05 } }),
    rect({ x: 700 + drift * 60, y: 80, width: 520, height: 520, radius: 260, color: "rgba(0,0,0,0)", shadow: { blur: 320, color: "rgba(20,184,138,0.30)" } }),
    rect({ x: -200 - drift * 40, y: 900, width: 560, height: 560, radius: 280, color: "rgba(0,0,0,0)", shadow: { blur: 340, color: "rgba(91,75,219,0.40)" } }),
    scene(0, 110, hook),
    scene(100, 190, bars),
    scene(280, 200, gallery),
    scene(470, 140, pipeline),
    scene(600, 120, outro),
    group({ opacity: interpolate(frame, [0, 20], [0, 1], clamp) }, [
      image({ src: "docs/logo.png", x: 40, y: 40, width: 56, height: 56, radius: 14, opacity: frame < 600 ? 1 : 0 }),
      text({ text: "fullgpu-render", x: 205, y: 68, size: 28, weight: 700, color: "#FFFFFF", opacity: frame < 600 ? 1 : 0 }),
    ]),
  ];
});
