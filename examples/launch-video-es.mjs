// Launch video in Spanish (4:5): kinetic hook, a live render race, speed lines, typed code, a frame travelling
// through the GPU pipeline and color wipes between scenes. Plays other examples inside cards: run `npm run examples` first.
// Render: node sdk/render.mjs examples/launch-video-es.mjs out/launch-video-es.mp4
import { composition, rect, text, image, video, group, sequence, spring, interpolate, Easing } from "../sdk/index.mjs";

const W = 1080;
const H = 1350;
const FPS = 30;
const CX = W / 2;
const TOTAL = 640;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const MINT = "#7CF3CF";
const CORAL = "#FF7A59";
const VIOLET = "#6C5CE7";
const INK = "#0B0F24";

// ── Recursos de animación ──────────────────────────────────────────────────────────────────────

const sp = (f, delay = 0, config = { damping: 12, stiffness: 160 }) => spring({ frame: f, fps: FPS, delay, config });
// Palabra que "golpea": entra grande y se asienta con un muelle.
const slam = (f, delay, node, { x = CX, y = 0 } = {}) => {
  const s = sp(f, delay, { damping: 11, stiffness: 220 });
  return group({ x, y, scale: 1.9 - 0.9 * s, opacity: Math.min(1, s * 3) }, node);
};
const rise = (f, delay, node) => {
  const s = sp(f, delay, { damping: 15, stiffness: 120 });
  return group({ y: (1 - s) * 50, opacity: s }, node);
};
const scene = (from, duration, render) =>
  sequence({ from, durationInFrames: duration }, (f) =>
    group({ opacity: Math.min(interpolate(f, [0, 6], [0, 1], clamp), interpolate(f, [duration - 6, duration], [1, 0], clamp)) }, render(f)),
  );
// Barrido de color a pantalla completa que tapa el corte entre escenas.
const wipe = (frame, at, color) => {
  const x = interpolate(frame, [at, at + 9, at + 18], [-W, 0, W], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return frame >= at && frame <= at + 18 ? rect({ x, y: 0, width: W, height: H, color }) : null;
};
const speedLines = (f, n = 9, color = "rgba(124,243,207,0.35)") =>
  Array.from({ length: n }, (_, i) => {
    const len = 220 + ((i * 97) % 260);
    const x = ((f * (55 + i * 6) + i * 211) % (W + len * 2)) - len;
    return rect({ x, y: 120 + ((i * 139) % (H - 240)), width: len, height: 5, radius: 3, color });
  });
const burst = (f, delay, cx, cy, n = 14) => {
  const s = sp(f, delay, { damping: 20, stiffness: 70 });
  const fade = interpolate(f, [delay + 12, delay + 34], [1, 0], clamp);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 120 + 380 * s;
    const size = i % 3 === 0 ? 22 : 12;
    return rect({ x: cx + Math.cos(a) * r - size / 2, y: cy + Math.sin(a) * r - size / 2, width: size, height: size, radius: size / 2, color: i % 2 ? MINT : VIOLET, opacity: fade * Math.min(1, s * 4) });
  });
};
const pill = (label, color, ink = "#FFFFFF", size = 34) => text({ text: label, x: 0, y: 0, size, weight: 900, color: ink, background: { color, padX: 30, padY: 12, radius: 40 } });

// ── Escenas ────────────────────────────────────────────────────────────────────────────────────

const hook = (f) => [
  slam(f, 2, text({ text: "10", x: 0, y: 0, size: 300, weight: 900, color: CORAL }), { y: 430 }),
  slam(f, 10, text({ text: "MINUTOS", x: 0, y: 0, size: 130, weight: 900, color: "#FFFFFF" }), { y: 640 }),
  rise(f, 22, text({ text: "para renderizar un vídeo de 4 minutos.", x: CX, y: 790, size: 44, weight: 600, color: "#C9C6F5" })),
  rise(f, 40, text({ text: "¿Y si lo hacemos en la GPU?", x: CX, y: 960, size: 54, weight: 800, color: MINT })),
];

const race = (f) => {
  const p = interpolate(f, [12, 72], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const gpuSec = 43 * p;
  const remSec = f < 72 ? gpuSec : 43 + (f - 72) * 1.6;
  const remP = remSec / 600;
  const done = sp(f, 74, { damping: 9, stiffness: 180 });
  const lane = (y, label, prog, color, secs, glow) => [
    text({ text: label, x: CX, y, size: 44, weight: 900, color: "#FFFFFF" }),
    rect({ x: 90, y: y + 50, width: 900, height: 70, radius: 35, color: "rgba(255,255,255,0.08)" }),
    rect({ x: 90, y: y + 50, width: Math.max(70, 900 * prog), height: 70, radius: 35, color, shadow: glow ? { blur: 40, color: "rgba(124,243,207,0.6)" } : undefined }),
    text({ text: `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`, x: CX, y: y + 170, size: 40, weight: 800, color: "#C9C6F5" }),
  ];
  return [
    rise(f, 0, [
      text({ text: "El mismo vídeo. El mismo portátil.", x: CX, y: 210, size: 50, weight: 900, color: "#FFFFFF" }),
      text({ text: "Renderizando a la vez:", x: CX, y: 280, size: 36, weight: 600, color: "#9C98D9" }),
    ]),
    ...lane(420, "Remotion", remP, CORAL, remSec, false),
    ...lane(760, "fullgpu-render", p, MINT, gpuSec, true),
    group({ x: CX, y: 1120, scale: 0.5 + 0.5 * done, opacity: done }, pill("¡LISTO en 43 s!", MINT, INK, 46)),
    group({ x: CX, y: 1240, opacity: interpolate(f, [95, 110], [0, 1], clamp) }, [
      text({ text: `Remotion todavía va por el ${Math.round(remP * 100)} %`, x: 0, y: 0, size: 34, weight: 700, color: CORAL }),
    ]),
  ];
};

const faster = (f) => [
  ...speedLines(f, 10),
  ...burst(f, 4, CX, 560),
  slam(f, 4, text({ text: "23×", x: 0, y: 0, size: 340, weight: 900, color: MINT }), { y: 560 }),
  slam(f, 14, text({ text: "MÁS RÁPIDO", x: 0, y: 0, size: 110, weight: 900, color: "#FFFFFF" }), { y: 790 }),
  rise(f, 26, text({ text: "Misma escena de 60 s: 204 s → 8,7 s", x: CX, y: 920, size: 42, weight: 700, color: "#C9C6F5" })),
];

const CODE = [
  "const pop = spring({ frame, fps });",
  "rect({ gradient, shadow })",
  "video({ src, playbackRate: 2 })",
  "text({ text: 'مرحبا 你好' })",
];
const code = (f) => {
  const typed = Math.floor(interpolate(f, [12, 80], [0, CODE.join("\n").length], clamp));
  const shown = CODE.join("\n").slice(0, typed) + (Math.floor(f / 8) % 2 ? "▌" : " ");
  const card = (delay, from, box, clip) => {
    const s = sp(f, delay, { damping: 14, stiffness: 120 });
    const [x, y, w, h] = box;
    return group({ x: x + (1 - s) * from, y, opacity: s }, [
      rect({ x: 0, y: 0, width: w, height: h, radius: 28, color: "#000000", shadow: { y: 30, blur: 70, color: "rgba(0,0,0,0.6)" } }),
      video({ ...clip, x: 0, y: 0, width: w, height: h, radius: 28 }),
    ]);
  };
  return [
    slam(f, 2, text({ text: "Escribe vídeos con código.", x: 0, y: 0, size: 64, weight: 900, color: "#FFFFFF" }), { y: 150 }),
    rise(f, 6, [
      rect({ x: 70, y: 220, width: 940, height: 300, radius: 26, color: "rgba(10,12,30,0.85)", shadow: { y: 16, blur: 40, color: "rgba(0,0,0,0.4)" } }),
      rect({ x: 100, y: 248, width: 16, height: 16, radius: 8, color: "#FF5F57" }),
      rect({ x: 126, y: 248, width: 16, height: 16, radius: 8, color: "#FEBC2E" }),
      rect({ x: 152, y: 248, width: 16, height: 16, radius: 8, color: "#28C840" }),
      text({ text: shown, x: CX, y: 390, size: 36, weight: 600, color: MINT }),
    ]),
    card(70, -W, [60, 580, 960, 540], { src: "out/app-promo.mp4", startFrom: 1.2, playbackRate: 0.9 }),
    card(84, W, [700, 830, 300, 480], { src: "out/social-vertical.mp4", startFrom: 0.6 }),
  ];
};

const STEPS = [
  ["NVDEC", "lee los clips en la GPU"],
  ["wgpu", "compone con shaders"],
  ["NVENC", "codifica en la GPU"],
];
const pipeline = (f) => {
  const dot = interpolate(f, [30, 90], [430, 1010], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return [
    slam(f, 2, text({ text: "Cada fotograma", x: 0, y: 0, size: 70, weight: 900, color: "#FFFFFF" }), { y: 170 }),
    slam(f, 8, text({ text: "se queda en la GPU.", x: 0, y: 0, size: 70, weight: 900, color: MINT }), { y: 255 }),
    rect({ x: CX - 4, y: 430, width: 8, height: 580 * interpolate(f, [10, 40], [0, 1], clamp), radius: 4, color: "rgba(124,243,207,0.35)" }),
    f >= 30 && f <= 92 && rect({ x: CX - 18, y: dot - 18, width: 36, height: 36, radius: 18, color: "#FFFFFF", shadow: { blur: 40, color: "rgba(255,255,255,0.9)" } }),
    ...STEPS.map(([name, detail], i) => {
      const s = sp(f, 10 + i * 8);
      const lit = Math.abs(dot - (430 + i * 290)) < 70 ? 1 : 0;
      return group({ x: CX, y: 430 + i * 290, scale: (0.7 + 0.3 * s) * (1 + 0.06 * lit), opacity: s }, [
        rect({ x: -330, y: -70, width: 660, height: 140, radius: 32, gradient: { from: lit ? MINT : "#14B88A", to: VIOLET, angle: 100 }, shadow: lit ? { blur: 50, color: "rgba(124,243,207,0.7)" } : undefined }),
        text({ text: name, x: 0, y: -20, size: 56, weight: 900, color: lit ? INK : "#FFFFFF" }),
        text({ text: detail, x: 0, y: 36, size: 30, weight: 700, color: lit ? INK : "#E9FBF5" }),
      ]);
    }),
    ...["Sin navegador.", "Sin capturas.", "Sin CPU."].map((t, i) =>
      group({ x: CX, y: 1190 + i * 0, opacity: interpolate(f, [60 + i * 10, 66 + i * 10, 66 + (i + 1) * 10, 70 + (i + 1) * 10], [0, 1, 1, i === 2 ? 1 : 0], clamp) }, [
        text({ text: t, x: 0, y: 0, size: 54, weight: 900, color: "#FFFFFF" }),
      ]),
    ),
  ];
};

const outro = (f) => {
  const l = sp(f, 0, { damping: 10, stiffness: 140 });
  const ring = interpolate(f, [4, 30], [0, 1], clamp);
  return [
    ...burst(f, 4, CX, 420, 16),
    rect({ x: CX - 150 - 120 * ring, y: 420 - 150 - 120 * ring, width: 300 + 240 * ring, height: 300 + 240 * ring, radius: 400, color: "rgba(0,0,0,0)", shadow: { blur: 60, color: `rgba(124,243,207,${(0.6 * (1 - ring)).toFixed(3)})` } }),
    group({ x: CX, y: 420, scale: 0.4 + 0.6 * l, opacity: l }, [image({ src: "docs/logo.png", x: -130, y: -130, width: 260, height: 260, radius: 58 })]),
    slam(f, 10, text({ text: "fullgpu-render", x: 0, y: 0, size: 100, weight: 900, color: "#FFFFFF" }), { y: 660 }),
    rise(f, 20, [
      text({ text: "Código abierto · MIT / Apache-2.0", x: CX, y: 760, size: 40, weight: 700, color: "#C9C6F5" }),
      text({ text: "Este vídeo se renderizó con él en 5 segundos.", x: CX, y: 840, size: 38, weight: 700, color: MINT }),
    ]),
    group({ x: CX, y: 1010, scale: 0.8 + 0.2 * sp(f, 30), opacity: sp(f, 30) }, pill("github.com/WassimAarab08/fullgpu-render", MINT, INK, 36)),
  ];
};

export default composition({ width: W, height: H, fps: FPS, durationInFrames: TOTAL, background: INK }, ({ frame }) => {
  const drift = Math.sin(frame / 45);
  return [
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: INK, to: "#2A1470", angle: 160 + frame * 0.08 } }),
    rect({ x: 640 + drift * 80, y: 40, width: 560, height: 560, radius: 280, color: "rgba(0,0,0,0)", shadow: { blur: 340, color: "rgba(20,184,138,0.32)" } }),
    rect({ x: -260 - drift * 60, y: 860, width: 600, height: 600, radius: 300, color: "rgba(0,0,0,0)", shadow: { blur: 360, color: "rgba(108,92,231,0.45)" } }),
    scene(0, 82, hook),
    scene(80, 132, race),
    scene(210, 92, faster),
    scene(300, 150, code),
    scene(448, 106, pipeline),
    scene(552, 88, outro),
    wipe(frame, 72, MINT),
    wipe(frame, 202, VIOLET),
    wipe(frame, 440, CORAL),
    frame < 552 && image({ src: "docs/logo.png", x: 36, y: 36, width: 52, height: 52, radius: 12 }),
    frame < 552 && text({ text: "fullgpu-render", x: 190, y: 62, size: 28, weight: 800, color: "#FFFFFF" }),
    rect({ x: 0, y: H - 10, width: W, height: 10, color: "rgba(255,255,255,0.12)" }),
    rect({ x: 0, y: H - 10, width: Math.max(10, (W * frame) / (TOTAL - 1)), height: 10, gradient: { from: MINT, to: VIOLET, angle: 90 } }),
  ];
});
