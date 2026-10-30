// Kinetic typography in seven scripts (Latin, Arabic RTL, Chinese, Cyrillic...) with color-shifting backgrounds.
// Render: node sdk/render.mjs examples/multilingual-titles.mjs out/multilingual-titles.mp4
import { composition, rect, text, group, spring, interpolate, interpolateColors } from "../sdk/index.mjs";

const W = 1920;
const H = 1080;
const FPS = 30;
const SLOT = 32;
const WORDS = [
  { word: "Hello", lang: "English" },
  { word: "مرحبا", lang: "العربية · Arabic" },
  { word: "你好", lang: "中文 · Chinese" },
  { word: "Hola", lang: "Español · Spanish" },
  { word: "Привет", lang: "Русский · Russian" },
  { word: "Olá", lang: "Português · Portuguese" },
  { word: "Bonjour", lang: "Français · French" },
];
const PALETTE = ["#14B88A", "#5B4BDB", "#E2603E", "#1D7FD8", "#D4537E", "#0F8A68", "#7F77DD"];
const steps = WORDS.map((_, i) => i * SLOT);

export default composition({ width: W, height: H, fps: FPS, durationInFrames: WORDS.length * SLOT + 40, background: "#0B0F24" }, ({ frame }) => {
  const i = Math.min(WORDS.length - 1, Math.floor(frame / SLOT));
  const local = frame - i * SLOT;
  const pop = spring({ frame: local, fps: FPS, config: { damping: 12, stiffness: 150 } });
  const out = interpolate(local, [SLOT - 6, SLOT], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const last = i === WORDS.length - 1;
  const a = interpolateColors(frame, steps, PALETTE);
  const b = interpolateColors(frame, steps, [...PALETTE.slice(1), PALETTE[0]]);
  const { word, lang } = WORDS[i];
  return [
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: a, to: b, angle: 135 + frame } }),
    rect({ x: 0, y: 0, width: W, height: H, color: "rgba(11,15,36,0.35)" }),
    group({ x: W / 2, y: H / 2 - 30, scale: 0.6 + 0.4 * pop, opacity: last ? pop : pop * out }, [
      text({ text: word, x: 0, y: 0, size: 230, weight: 900, color: "#FFFFFF" }),
      text({ text: lang, x: 0, y: 180, size: 40, weight: 600, color: "rgba(255,255,255,0.85)" }),
    ]),
    ...WORDS.map((_, j) =>
      rect({ x: W / 2 - WORDS.length * 22 + j * 44, y: 960, width: j === i ? 32 : 12, height: 12, radius: 6, color: j <= i ? "#FFFFFF" : "rgba(255,255,255,0.35)" }),
    ),
    text({ text: "Shaped with HarfBuzz-grade text on the GPU · fullgpu-render", x: W / 2, y: 1020, size: 26, weight: 600, color: "rgba(255,255,255,0.8)" }),
  ];
});
