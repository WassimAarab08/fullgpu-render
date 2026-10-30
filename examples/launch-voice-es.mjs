// Voice-led launch video in Spanish (4:5). Every shot is timed to a line of the voice-over.
// Needs the voice-over at media/voz-lanzamiento.mp3 (not in the repo; record your own and adjust the cue times).
// Render: node sdk/render.mjs examples/launch-voice-es.mjs out/launch-voice-es.mp4
import { composition, rect, text, image, audio, group, sequence, interpolate, Easing } from "../sdk/index.mjs";

const W = 1080;
const H = 1350;
const FPS = 30;
const CX = W / 2;
const LEAD = 15; // medio segundo antes de la primera palabra
const TOTAL = 1170;

const BG = "#0E0F13";
const PANEL = "#16181F";
const LINE = "#262A35";
const TEXT = "#F2F3F5";
const MUTED = "#8B90A0";
const ACCENT = "#7CF3CF";
const WARN = "#FF8A65";
const MONO = "Consolas";

// Inicio de cada frase de la locución (segundos, medidos con silencedetect) -> fotogramas.
const at = (sec) => LEAD + Math.round(sec * FPS);
const CUE = {
  diezMinutos: at(0.0),
  cadaVideo: at(2.72),
  siete: at(5.04),
  unDia: at(7.32),
  ceroPorCiento: at(11.01),
  construi: at(15.07),
  unMotor: at(17.84),
  lee: at(18.6),
  compone: at(19.2),
  codifica: at(19.9),
  sinSalir: at(21.6),
  sigues: at(23.6),
  cuarentaYTres: at(26.64),
  veintitres: at(29.36),
  codigoAbierto: at(32.24),
  enlace: at(34.32),
};

const ease = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
// Entrada uniforme en todo el vídeo: sube 24 px y aparece en 18 fotogramas.
const enter = (f, from, node, dur = 18) => {
  const p = interpolate(f, [from, from + dur], [0, 1], { ...clamp, easing: ease });
  return group({ y: (1 - p) * 24, opacity: p }, node);
};
const shot = (from, to, render) =>
  sequence({ from, durationInFrames: to - from }, (f) => {
    const o = Math.min(interpolate(f, [0, 12], [0, 1], clamp), interpolate(f, [to - from - 12, to - from], [1, 0], clamp));
    return group({ opacity: o }, render(f + from)); // los planos trabajan con el fotograma absoluto (las marcas de la voz)
  });
// Ventana con barra de título y "semáforo", como una app real.
const windowFrame = (x, y, w, h, title) => [
  rect({ x, y, width: w, height: h, radius: 22, color: PANEL, shadow: { y: 30, blur: 80, color: "rgba(0,0,0,0.55)" } }),
  rect({ x, y, width: w, height: 56, radius: 22, color: "#1C1F28" }),
  rect({ x, y: y + 40, width: w, height: 16, color: "#1C1F28" }),
  ...["#FF5F57", "#FEBC2E", "#28C840"].map((c, i) => rect({ x: x + 26 + i * 26, y: y + 21, width: 14, height: 14, radius: 7, color: c })),
  text({ text: title, x: x + w / 2, y: y + 28, size: 22, weight: 600, color: MUTED }),
];
const mono = (s, x, y, color = TEXT, size = 30) => text({ text: s, x, y, size, weight: 400, color, font: MONO, align: "left" });
const typed = (s, f, from, cps = 22) => s.slice(0, Math.max(0, Math.floor(((f - from) / FPS) * cps)));
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// ── Plano 1: "Diez minutos… cada vídeo… y tenía siete." ────────────────────────────────────
const slowRender = (f) => {
  const push = interpolate(f, [0, 230], [1, 1.05], clamp);
  const cmd = "$ npx remotion render JamfParent-es";
  const progress = interpolate(f, [70, 230], [0.12, 0.2], clamp);
  const done = Math.round(6816 * progress);
  return [
    enter(f, CUE.diezMinutos, text({ text: "10 minutos.", x: CX, y: 170, size: 104, weight: 800, color: TEXT })),
    enter(f, CUE.cadaVideo, text({ text: "Por cada vídeo.", x: CX, y: 260, size: 44, weight: 500, color: MUTED })),
    group({ x: CX, y: 640, scale: push }, [
      group({ x: -470, y: -230 }, [
        ...windowFrame(0, 0, 940, 460, "remotion — render"),
        mono(typed(cmd, f, 20, 26), 40, 110, ACCENT),
        f > 60 && mono(`Rendering   ${done.toLocaleString("es-ES")} / 6.816 frames`, 40, 170, TEXT),
        f > 60 && rect({ x: 40, y: 210, width: 860, height: 18, radius: 9, color: LINE }),
        f > 60 && rect({ x: 40, y: 210, width: 860 * progress, height: 18, radius: 9, color: WARN }),
        f > 60 && mono(`Tiempo restante  ${clock(600 - (f - 60) / 3)}`, 40, 280, MUTED),
        f > 60 && mono("GPU NVIDIA       sin usar", 40, 330, MUTED),
      ]),
    ]),
    ...["ES", "AR", "ZH", "UK", "RO", "RU", "PT"].map((l, i) =>
      enter(f, CUE.siete + i * 3, text({ text: l, x: CX - 3 * 128 + i * 128, y: 1080, size: 34, weight: 700, color: TEXT, background: { color: "#20232D", padX: 22, padY: 12, radius: 14 } }), 12),
    ),
    enter(f, CUE.siete + 22, text({ text: "Y eran siete idiomas.", x: CX, y: 1170, size: 40, weight: 500, color: MUTED })),
  ];
};

// ── Plano 2: el administrador de tareas: la GPU al 0 %. ────────────────────────────────────
const taskManager = (f) => {
  const bars = 22;
  const cpu = (i) => 0.45 + 0.25 * Math.abs(Math.sin((i + f / 6) * 0.9)) * Math.abs(Math.cos((i + f / 9) * 0.4));
  const focus = interpolate(f, [CUE.ceroPorCiento, CUE.ceroPorCiento + 15], [0, 1], { ...clamp, easing: ease });
  const graph = (y, label, sub, values, value, hot) => [
    text({ text: label, x: 120, y, size: 34, weight: 700, color: TEXT, align: "left" }),
    text({ text: sub, x: 120, y: y + 40, size: 22, weight: 500, color: MUTED, align: "left" }),
    text({ text: value, x: 960, y: y + 10, size: hot ? 34 + 16 * focus : 34, weight: 800, color: hot ? (focus > 0.5 ? WARN : TEXT) : TEXT }),
    rect({ x: 110, y: y + 80, width: 860, height: 190, radius: 14, color: "#12141A" }),
    ...values.map((v, i) => rect({ x: 120 + i * (840 / bars), y: y + 260 - 170 * v, width: 840 / bars - 8, height: Math.max(3, 170 * v), radius: 4, color: hot ? WARN : "#5B8CFF" })),
  ];
  return [
    enter(f, CUE.unDia, windowFrame(70, 150, 940, 920, "Administrador de tareas")),
    enter(f, CUE.unDia + 6, graph(260, "CPU", "i7-12650H", Array.from({ length: bars }, (_, i) => cpu(i)), `${Math.round(cpu(bars - 1) * 100)} %`, false)),
    enter(f, CUE.unDia + 12, graph(640, "GPU 1", "NVIDIA GeForce RTX 4050", Array.from({ length: bars }, () => 0), "0 %", true)),
    enter(f, CUE.ceroPorCiento + 4, text({ text: "La tarjeta gráfica, sin hacer nada.", x: CX, y: 1170, size: 46, weight: 700, color: TEXT })),
  ];
};

// ── Plano 3: "Así que construí FullGPU Render… sin salir de la tarjeta." ───────────────────
const STEPS = [
  ["Lee", "decodifica los vídeos · NVDEC", CUE.lee],
  ["Compone", "dibuja cada fotograma · wgpu", CUE.compone],
  ["Codifica", "crea el MP4 · NVENC", CUE.codifica],
];
const reveal = (f) => {
  const logo = interpolate(f, [CUE.construi, CUE.construi + 24], [0, 1], { ...clamp, easing: ease });
  const box = interpolate(f, [CUE.sinSalir, CUE.sinSalir + 20], [0, 1], { ...clamp, easing: ease });
  return [
    group({ x: CX, y: 250, scale: 0.94 + 0.06 * logo, opacity: logo }, [image({ src: "docs/logo.png", x: -90, y: -90, width: 180, height: 180, radius: 40 })]),
    enter(f, CUE.construi + 10, text({ text: "fullgpu-render", x: CX, y: 420, size: 84, weight: 800, color: TEXT })),
    box > 0 && rect({ x: 120, y: 560, width: 840, height: 600, radius: 34, color: ACCENT, opacity: box * 0.9 }),
    box > 0 && rect({ x: 124, y: 564, width: 832, height: 592, radius: 31, color: BG }),
    box > 0 && text({ text: "Todo dentro de la GPU", x: CX, y: 560, size: 30, weight: 800, color: BG, opacity: box, background: { color: ACCENT, padX: 22, padY: 8, radius: 16 } }),
    ...STEPS.map(([name, detail, cue], i) => {
      const lit = interpolate(f, [cue, cue + 10], [0, 1], clamp);
      return enter(f, CUE.unMotor + i * 4, [
        rect({ x: 180, y: 640 + i * 170, width: 720, height: 130, radius: 24, color: lit > 0.5 ? "#1D2A28" : PANEL }),
        rect({ x: 180, y: 640 + i * 170, width: 10, height: 130, radius: 5, color: lit > 0.5 ? ACCENT : LINE }),
        text({ text: name, x: 230, y: 685 + i * 170, size: 46, weight: 800, color: lit > 0.5 ? ACCENT : TEXT, align: "left" }),
        text({ text: detail, x: 230, y: 735 + i * 170, size: 26, weight: 500, color: MUTED, align: "left" }),
      ]);
    }),
  ];
};

// ── Plano 4: "Sigues escribiendo el vídeo con código, como siempre." ───────────────────────
const CODE = [
  ["composition({ fps: 30 }, ({ frame }) => [", TEXT],
  ["  text({ text: \"Hola\", opacity: fade(frame) }),", ACCENT],
  ["  video({ src: \"demo.mp4\", playbackRate: 2 }),", "#9CC4FF"],
  ["])", TEXT],
];
const editor = (f) => {
  const start = CUE.sigues + 6;
  let budget = Math.floor(((f - start) / FPS) * 75);
  return [
    enter(f, CUE.sigues, text({ text: "Sigues escribiendo con código.", x: CX, y: 230, size: 56, weight: 800, color: TEXT })),
    enter(f, CUE.sigues + 4, [
      ...windowFrame(60, 400, 960, 400, "launch.mjs"),
      ...CODE.map(([line, color], i) => {
        const shown = line.slice(0, Math.max(0, budget));
        budget -= line.length;
        return shown && mono(shown, 100, 500 + i * 70, color, 28);
      }),
    ]),
  ];
};

// ── Plano 5: "¡Pero ahora tarda cuarenta y tres segundos! Veintitrés veces más rápido." ────
const result = (f) => {
  const race = interpolate(f, [CUE.cuarentaYTres + 10, CUE.cuarentaYTres + 50], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return [
    enter(f, CUE.cuarentaYTres - 8, [
      ...windowFrame(60, 150, 960, 300, "fullgpu-render"),
      mono("$ npm run render -- jamf-es.mjs out/jamf-es.mp4", 100, 250, ACCENT, 26),
      f > CUE.cuarentaYTres + 6 && mono("6.816 frames · voz · subtítulos", 100, 310, TEXT, 26),
      f > CUE.cuarentaYTres + 14 && mono("Listo en 43 s", 100, 370, ACCENT, 30),
    ]),
    enter(f, CUE.cuarentaYTres + 8, text({ text: "43 s", x: CX, y: 640, size: 200, weight: 800, color: TEXT })),
    enter(f, CUE.cuarentaYTres + 20, [
      text({ text: "Remotion", x: 120, y: 860, size: 30, weight: 700, color: MUTED, align: "left" }),
      text({ text: "10:00", x: 960, y: 860, size: 30, weight: 700, color: MUTED }),
      rect({ x: 120, y: 890, width: 840, height: 22, radius: 11, color: LINE }),
      rect({ x: 120, y: 890, width: 840 * race, height: 22, radius: 11, color: "#4A4F5E" }),
      text({ text: "fullgpu-render", x: 120, y: 970, size: 30, weight: 700, color: TEXT, align: "left" }),
      text({ text: "0:43", x: 960, y: 970, size: 30, weight: 700, color: ACCENT }),
      rect({ x: 120, y: 1000, width: 840, height: 22, radius: 11, color: LINE }),
      rect({ x: 120, y: 1000, width: Math.max(22, 840 * (43 / 600) * race), height: 22, radius: 11, color: ACCENT }),
    ]),
    enter(f, CUE.veintitres, text({ text: "23 veces más rápido.", x: CX, y: 1150, size: 64, weight: 800, color: ACCENT })),
  ];
};

// ── Plano 6: "Y es código abierto. Te dejo el enlace en los comentarios." ──────────────────
const endCard = (f) => [
  enter(f, CUE.codigoAbierto - 6, group({ x: CX, y: 430 }, [image({ src: "docs/logo.png", x: -110, y: -110, width: 220, height: 220, radius: 48 })]), 24),
  enter(f, CUE.codigoAbierto, text({ text: "fullgpu-render", x: CX, y: 640, size: 90, weight: 800, color: TEXT })),
  enter(f, CUE.codigoAbierto + 8, text({ text: "Código abierto · MIT / Apache-2.0", x: CX, y: 730, size: 38, weight: 500, color: MUTED })),
  enter(f, CUE.enlace, text({ text: "github.com/WassimAarab08/fullgpu-render", x: CX, y: 900, size: 34, weight: 700, color: BG, background: { color: ACCENT, padX: 34, padY: 18, radius: 18 } })),
];

export default composition({ width: W, height: H, fps: FPS, durationInFrames: TOTAL, background: BG }, ({ frame }) => [
  rect({ x: 0, y: 0, width: W, height: H, gradient: { from: "#11131A", to: BG, angle: 180 } }),
  audio({ src: "media/voz-lanzamiento.mp3", from: LEAD }),
  shot(0, CUE.unDia - 6, slowRender),
  shot(CUE.unDia - 8, CUE.construi - 6, taskManager),
  shot(CUE.construi - 8, CUE.sigues - 4, reveal),
  shot(CUE.sigues - 6, CUE.cuarentaYTres - 10, editor),
  shot(CUE.cuarentaYTres - 12, CUE.codigoAbierto - 8, result),
  shot(CUE.codigoAbierto - 10, TOTAL, endCard),
]);
