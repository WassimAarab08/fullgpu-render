// Animated data story: the project's own benchmark as growing bars, counting labels and a punchline.
// Render: node sdk/render.mjs examples/benchmark-story.mjs out/benchmark-story.mp4
import { composition, rect, text, image, group, spring, interpolate, Easing } from "../sdk/index.mjs";

const W = 1920;
const H = 1080;
const FPS = 30;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// Seconds to render the same 60-second 1080p scene on one laptop (RTX 4050), lower is better.
const ROWS = [
  { label: "Remotion", detail: "headless Chrome + screenshots", seconds: 204.1, color: "#E2603E" },
  { label: "Remotion + NVENC", detail: "hardware encode only", seconds: 172.8, color: "#F0997B" },
  { label: "fullgpu · browser", detail: "WebGPU + WebCodecs", seconds: 13.2, color: "#7CF3CF" },
  { label: "fullgpu · native", detail: "NVDEC → wgpu → NVENC", seconds: 8.7, color: "#14B88A" },
];
const MAX = 204.1;
const BAR_X = 640;
const BAR_W = 1080;

export default composition({ width: W, height: H, fps: FPS, durationInFrames: 270, background: "#0B0F24" }, ({ frame }) => {
  const title = spring({ frame, fps: FPS, config: { damping: 15 } });
  const punch = spring({ frame, fps: FPS, delay: 170, config: { damping: 9, stiffness: 120 } });
  const dim = interpolate(frame, [165, 185], [1, 0.35], clamp);
  return [
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: "#0B0F24", to: "#1A1240", angle: 160 } }),
    image({ src: "docs/logo.png", x: 120, y: 80, width: 56, height: 56, radius: 12 }),
    text({ text: "fullgpu-render", x: 280, y: 108, size: 28, weight: 700, color: "#FFFFFF" }),
    group({ x: 0, y: (1 - title) * 30, opacity: title }, [
      text({ text: "Same 60-second 1080p scene. Same laptop.", x: W / 2, y: 230, size: 58, weight: 800, color: "#FFFFFF" }),
      text({ text: "Time to render (seconds, lower is better)", x: W / 2, y: 300, size: 30, weight: 500, color: "#9C98D9" }),
    ]),
    ...ROWS.flatMap((row, i) => {
      const y = 400 + i * 140;
      const grow = spring({ frame, fps: FPS, delay: 25 + i * 18, config: { damping: 18, stiffness: 90 } });
      const value = interpolate(grow, [0, 1], [0, row.seconds], clamp);
      const w = Math.max(24, (BAR_W * row.seconds * grow) / MAX);
      const fade = interpolate(frame, [20 + i * 18, 35 + i * 18], [0, 1], clamp);
      const focus = i === 3 ? 1 : dim;
      return [
        group({ x: 0, y: 0, opacity: fade * focus }, [
          text({ text: row.label, x: 360, y: y + 26, size: 34, weight: 800, color: "#FFFFFF" }),
          text({ text: row.detail, x: 360, y: y + 70, size: 22, weight: 500, color: "#9C98D9" }),
          rect({ x: BAR_X, y, width: BAR_W, height: 76, radius: 18, color: "rgba(255,255,255,0.06)" }),
          rect({ x: BAR_X, y, width: w, height: 76, radius: 18, color: row.color, shadow: i === 3 ? { blur: 40, color: "rgba(20,184,138,0.5)" } : undefined }),
          text({ text: `${value.toFixed(1)} s`, x: Math.min(BAR_X + w + 90, BAR_X + BAR_W - 70), y: y + 38, size: 32, weight: 800, color: "#FFFFFF" }),
        ]),
      ];
    }),
    group({ x: 1560, y: 860, scale: 0.4 + 0.6 * punch, opacity: Math.min(1, punch * 1.5) }, [
      rect({ x: -230, y: -95, width: 460, height: 190, radius: 40, gradient: { from: "#14B88A", to: "#5B4BDB", angle: 120 }, shadow: { y: 20, blur: 60, color: "rgba(20,184,138,0.5)" } }),
      text({ text: "23×", x: 0, y: -18, size: 110, weight: 900, color: "#FFFFFF" }),
      text({ text: "faster than Remotion", x: 0, y: 58, size: 30, weight: 700, color: "#E9FBF5" }),
    ]),
  ];
});
