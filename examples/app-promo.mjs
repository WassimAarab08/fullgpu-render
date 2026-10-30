// Product promo: kinetic headline, a phone that springs in and a live fitness-app UI drawn with shapes and text.
// Render: node sdk/render.mjs examples/app-promo.mjs out/app-promo.mp4
import { composition, rect, text, image, group, spring, interpolate, Easing } from "../sdk/index.mjs";

const W = 1920;
const H = 1080;
const FPS = 30;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// Soft glowing blob: an invisible rect whose large blurred shadow is the glow.
const blob = (x, y, size, color) =>
  rect({ x: x - size / 2, y: y - size / 2, width: size, height: size, radius: size / 2, color: "rgba(0,0,0,0)", shadow: { blur: size * 0.6, color } });

const headline = (frame) =>
  [
    ["Your app,", "#FFFFFF"],
    ["in motion.", "#7CF3CF"],
  ].map(([line, color], i) => {
    const s = spring({ frame, fps: FPS, delay: 8 + i * 8, config: { damping: 14 } });
    return text({ text: line, x: 560, y: 300 + i * 125 + (1 - s) * 60, size: 120, weight: 800, color, opacity: s });
  });

const card = (frame, i, y, h, children) => {
  const s = spring({ frame, fps: FPS, delay: 40 + i * 10, config: { damping: 13, stiffness: 140 } });
  return group({ x: 0, y: y + (1 - s) * 40, opacity: s }, [
    rect({ x: 24, y: 0, width: 348, height: h, radius: 24, color: "#FFFFFF", shadow: { y: 8, blur: 24, color: "rgba(30,20,80,0.10)" } }),
    ...children,
  ]);
};

const phoneUI = (frame) => {
  const steps = Math.round(interpolate(frame, [50, 150], [0, 12480], { ...clamp, easing: Easing.out(Easing.cubic) }));
  const progress = interpolate(frame, [50, 150], [0, 0.83], { ...clamp, easing: Easing.out(Easing.cubic) });
  const bars = [0.45, 0.7, 0.55, 0.9, 0.65, 0.8, 0.5];
  return [
    rect({ x: 0, y: 0, width: 396, height: 820, radius: 48, gradient: { from: "#F5F3FF", to: "#E9FBF5", angle: 160 } }),
    text({ text: "9:41", x: 60, y: 36, size: 22, weight: 700, color: "#1B1B2F" }),
    text({ text: "Good morning, Alex", x: 198, y: 110, size: 34, weight: 800, color: "#1B1B2F" }),
    text({ text: "Thursday · 3 goals left", x: 198, y: 150, size: 20, weight: 500, color: "#6B6B85" }),
    card(frame, 0, 190, 170, [
      text({ text: "Steps today", x: 198, y: 36, size: 20, weight: 600, color: "#6B6B85" }),
      text({ text: steps.toLocaleString("en-US"), x: 198, y: 86, size: 54, weight: 800, color: "#1B1B2F" }),
      rect({ x: 56, y: 128, width: 284, height: 14, radius: 7, color: "#ECEAF7" }),
      rect({ x: 56, y: 128, width: Math.max(14, 284 * progress), height: 14, radius: 7, gradient: { from: "#14B88A", to: "#5B4BDB", angle: 90 } }),
    ]),
    card(frame, 1, 380, 200, [
      text({ text: "Active minutes", x: 198, y: 34, size: 20, weight: 600, color: "#6B6B85" }),
      ...bars.map((b, i) => {
        const g = spring({ frame, fps: FPS, delay: 70 + i * 4, config: { damping: 12 } });
        const h = 110 * b * g;
        return rect({ x: 62 + i * 42, y: 176 - h, width: 26, height: Math.max(2, h), radius: 8, color: i === 3 ? "#5B4BDB" : "#B9B2F2" });
      }),
    ]),
    card(frame, 2, 600, 120, [
      text({ text: "Sleep", x: 110, y: 40, size: 20, weight: 600, color: "#6B6B85" }),
      text({ text: "7h 42m", x: 128, y: 80, size: 36, weight: 800, color: "#1B1B2F" }),
      rect({ x: 236, y: 34, width: 100, height: 52, radius: 26, color: "#E7FAF3" }),
      text({ text: "+12%", x: 286, y: 60, size: 24, weight: 800, color: "#0F8A68" }),
    ]),
  ];
};

export default composition({ width: W, height: H, fps: FPS, durationInFrames: 240, background: "#0B0F24" }, ({ frame }) => {
  const enter = spring({ frame, fps: FPS, delay: 20, config: { damping: 16, mass: 1.2 } });
  const drift = Math.sin(frame / 40) * 14;
  const sub = interpolate(frame, [40, 60], [0, 1], clamp);
  const cta = spring({ frame, fps: FPS, delay: 70, config: { damping: 10, stiffness: 160 } });
  const outro = interpolate(frame, [200, 230], [0, 1], clamp);
  return [
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: "#0B0F24", to: "#26136B", angle: 120 + frame * 0.15 } }),
    blob(1380 + drift * 3, 300, 520, "rgba(20,184,138,0.35)"),
    blob(1650, 860 - drift * 2, 460, "rgba(91,75,219,0.45)"),
    blob(300, 900 + drift, 380, "rgba(124,243,207,0.12)"),
    image({ src: "docs/logo.png", x: 120, y: 90, width: 64, height: 64, radius: 14, opacity: interpolate(frame, [0, 15], [0, 1], clamp) }),
    text({ text: "fullgpu-render", x: 290, y: 122, size: 30, weight: 700, color: "#FFFFFF", opacity: interpolate(frame, [0, 15], [0, 1], clamp) }),
    ...headline(frame),
    text({ text: "Programmatic video, rendered end to end on the GPU.", x: 560, y: 545, size: 34, weight: 500, color: "#C9C6F5", opacity: sub }),
    group({ x: 560, y: 670, scale: 0.6 + 0.4 * cta, opacity: cta }, [
      rect({ x: -170, y: -42, width: 340, height: 84, radius: 42, gradient: { from: "#14B88A", to: "#5B4BDB", angle: 90 }, shadow: { y: 12, blur: 40, color: "rgba(20,184,138,0.45)" } }),
      text({ text: "23× faster renders", x: 0, y: 0, size: 32, weight: 800, color: "#FFFFFF" }),
    ]),
    group({ x: 1190, y: 140 + (1 - enter) * 900 + drift * 0.5, opacity: enter }, [
      rect({ x: -18, y: -18, width: 432, height: 856, radius: 64, color: "#0E0E14", shadow: { y: 50, blur: 90, color: "rgba(0,0,0,0.55)" } }),
      ...phoneUI(frame),
    ]),
    rect({ x: 0, y: 0, width: W, height: H, color: "#0B0F24", opacity: outro }),
    group({ x: W / 2, y: H / 2 - 40, scale: 0.8 + 0.2 * outro, opacity: outro }, [
      image({ src: "docs/logo.png", x: -80, y: -170, width: 160, height: 160, radius: 36 }),
      text({ text: "fullgpu-render", x: 0, y: 70, size: 72, weight: 800, color: "#FFFFFF" }),
      text({ text: "github.com/WassimAarab08/fullgpu-render", x: 0, y: 150, size: 30, weight: 500, color: "#9C98D9" }),
    ]),
  ];
});
