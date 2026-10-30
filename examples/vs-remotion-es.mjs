// "fullgpu-render vs Remotion", Spanish, 4:5, led by a voice-over. Design: a video-editor timeline. A ruler with a
// playhead runs across the top for the whole film; the Remotion half lives on light paper, and when the narrator says
// "Así que hice FullGPU Render" a signal-blue panel sweeps in and the rest happens on blue. Numbers are big stopwatches.
// Voice-over: media/voz-remotion.mp3 (optional; without it the video renders silent). Retime CUE to your recording.
// Render: node sdk/render.mjs examples/vs-remotion-es.mjs out/vs-remotion-es.mp4
import { existsSync } from "node:fs";
import { composition, rect, text, image, audio, group, sequence, interpolate, Easing } from "../sdk/index.mjs";

const W = 1080;
const H = 1350;
const FPS = 30;
const M = 90; // margen izquierdo de toda la composición
const VOICE = "media/voz-remotion.mp3";

const PAPER = "#E6E9EE";
const INK = "#121B2E";
const GRAPHITE = "#5B667A";
const RULE = "#C5CCD6";
const SLOW = "#A7AFBD";
const SIGNAL = "#2448FF";
const SIGNAL_DEEP = "#1A36C8";
const WHITE = "#FFFFFF";
const DISPLAY = "Bahnschrift";
const CODE = "Cascadia Code";

// Segundo en que empieza cada frase de la locución.
const S = {
  usas: 0.0,
  barra: 3.0,
  chrome: 5.6,
  captura: 9.1,
  portatil: 11.6,
  cero: 14.2,
  medi: 16.3,
  doscientos: 19.0,
  hice: 21.8,
  escribes: 24.0,
  spring: 25.6,
  interpolate: 26.4,
  secuencias: 27.4,
  sinNavegador: 29.0,
  dentroGPU: 30.6,
  mismoMinuto: 33.0,
  ocho: 34.6,
  veintitres: 36.4,
  todavia: 39.0,
  abierto: 41.5,
  enlace: 44.0,
  fin: 47.5,
};
const LEAD = 12;
const CUE = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, LEAD + Math.round(s * FPS)]));
const TOTAL = CUE.fin;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const quint = Easing.out(Easing.poly(5));
const prog = (f, from, dur, easing = quint) => interpolate(f, [from, from + dur], [0, 1], { ...clamp, easing });
// Única entrada del vídeo: el elemento llega desde la derecha como un clip que se coloca en la línea de tiempo.
const clip = (f, from, node, dist = 70) => {
  const p = prog(f, from, 16);
  return group({ x: (1 - p) * dist, opacity: Math.min(1, p * 2) }, node);
};
const shot = (from, to, render) =>
  sequence({ from, durationInFrames: to - from }, (f) =>
    group({ opacity: Math.min(interpolate(f, [0, 6], [0, 1], clamp), interpolate(f, [to - from - 8, to - from], [1, 0], clamp)) }, render(f + from)),
  );
const display = (s, x, y, size, color, weight = 700) => text({ text: s, x, y, size, weight, color, font: DISPLAY, align: "left" });
const body = (s, x, y, size, color, weight = 500) => text({ text: s, x, y, size, weight, color, align: "left" });
const code = (s, x, y, color, size = 28) => text({ text: s, x, y, size, weight: 400, color, font: CODE, align: "left" });
const seconds = (v) => `${v.toFixed(1).replace(".", ",")} s`;

// ── Regla de línea de tiempo con cabezal (la firma del vídeo) ──────────────────────────────
function timeline(frame) {
  const onBlue = frame >= CUE.hice + 10;
  const ink = onBlue ? WHITE : INK;
  const faint = onBlue ? "rgba(255,255,255,0.35)" : RULE;
  const x0 = M;
  const x1 = W - M;
  const xAt = (f) => x0 + ((x1 - x0) * f) / TOTAL;
  const ticks = Array.from({ length: Math.floor(TOTAL / (5 * FPS)) + 1 }, (_, i) =>
    rect({ x: xAt(i * 5 * FPS) - 1, y: 92, width: 2, height: i % 2 ? 10 : 18, color: faint }),
  );
  return [
    rect({ x: x0, y: 110, width: x1 - x0, height: 2, color: faint }),
    rect({ x: x0, y: 116, width: xAt(CUE.hice) - x0 - 4, height: 8, radius: 4, color: onBlue ? "rgba(255,255,255,0.25)" : SLOW }),
    rect({ x: xAt(CUE.hice), y: 116, width: x1 - xAt(CUE.hice), height: 8, radius: 4, color: onBlue ? WHITE : "rgba(36,72,255,0.35)" }),
    body("Remotion", x0, 150, 22, onBlue ? "#C9D3FF" : GRAPHITE),
    body("fullgpu-render", xAt(CUE.hice) + 4, 150, 22, onBlue ? WHITE : GRAPHITE),
    ...ticks,
    rect({ x: xAt(frame) - 1.5, y: 84, width: 3, height: 46, color: ink }),
    rect({ x: xAt(frame) - 7, y: 78, width: 14, height: 14, radius: 3, color: ink }),
  ];
}

// ── Remotion ───────────────────────────────────────────────────────────────────────────────
const progressBar = (f) => {
  const p = interpolate(f, [CUE.usas, CUE.chrome], [0.061, 0.083], clamp);
  return [
    clip(f, CUE.usas + 4, display("Si usas Remotion,", M, 300, 88, INK)),
    clip(f, CUE.barra, display("esta barra te suena.", M, 400, 88, INK)),
    clip(f, CUE.usas + 14, [
      body("Renderizando fotogramas", M, 640, 28, GRAPHITE),
      display(`${Math.round(6816 * p).toLocaleString("es-ES")} de 6.816`, M, 715, 64, INK, 600),
      rect({ x: M, y: 790, width: W - 2 * M, height: 30, radius: 15, color: "#D3D8E0" }),
      rect({ x: M, y: 790, width: (W - 2 * M) * p, height: 30, radius: 15, color: SLOW }),
      body(`Tiempo restante: ${9 - Math.floor((f - CUE.usas) / 90)} min`, M, 870, 28, GRAPHITE),
    ]),
  ];
};

const capture = (f) => {
  const cells = 7;
  const cellW = 116;
  const every = 11; // un fotograma capturado cada 11 fotogramas de vídeo: lento a propósito
  const shotIndex = Math.floor((f - CUE.chrome - 10) / every);
  return [
    clip(f, CUE.chrome, display("Abre un Chrome invisible", M, 300, 72, INK)),
    clip(f, CUE.captura, display("y captura cada fotograma.", M, 385, 72, INK)),
    ...Array.from({ length: cells }, (_, i) => {
      const n = shotIndex - (cells - 1 - i);
      const taken = n >= 0;
      const flash = n === shotIndex && (f - CUE.chrome - 10) % every < 2;
      const x = M + i * (cellW + 12);
      return [
        rect({ x, y: 560, width: cellW, height: 190, radius: 10, color: flash ? WHITE : taken ? "#CBD1DA" : "#DCE0E7" }),
        taken && !flash && rect({ x: x + 14, y: 582, width: cellW - 28, height: 92, radius: 6, color: "#B6BECA" }),
        taken && !flash && rect({ x: x + 14, y: 690, width: (cellW - 28) * 0.7, height: 10, radius: 5, color: "#B6BECA" }),
      ];
    }),
    clip(f, CUE.chrome + 20, [
      body("Fotograma", M, 820, 26, GRAPHITE),
      display(Math.max(0, 418 + shotIndex).toLocaleString("es-ES"), M, 880, 56, INK, 600),
      body("Chrome lo dibuja, Remotion le hace una captura y FFmpeg la codifica.", M, 980, 28, GRAPHITE),
    ]),
  ];
};

const gpuIdle = (f) => [
  clip(f, CUE.portatil, display("Y la tarjeta gráfica,", M, 300, 72, INK)),
  clip(f, CUE.portatil + 6, body("Uso de la GPU (RTX 4050 del portátil)", M, 520, 30, GRAPHITE)),
  clip(f, CUE.cero, display("0 %", M - 8, 720, 300, INK, 700), 120),
  clip(f, CUE.portatil + 10, [
    rect({ x: M, y: 930, width: W - 2 * M, height: 2, color: INK }),
    body("Mientras tanto la CPU, al 52 %.", M, 990, 30, GRAPHITE),
  ]),
];

const measured = (f) => {
  const v = interpolate(f, [CUE.doscientos - 30, CUE.doscientos + 18], [0, 204.1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return [
    clip(f, CUE.medi, display("Una escena de un minuto.", M, 300, 72, INK)),
    clip(f, CUE.medi + 8, body("Lo medí en mi portátil.", M, 380, 34, GRAPHITE)),
    clip(f, CUE.doscientos - 30, display(seconds(v), M - 6, 640, 230, INK, 700), 0),
    clip(f, CUE.doscientos + 10, code("npx remotion render --concurrency=8", M, 840, GRAPHITE, 26)),
  ];
};

// ── fullgpu-render, sobre azul ─────────────────────────────────────────────────────────────
const reveal = (f) => [
  clip(f, CUE.hice + 12, group({}, [image({ src: "docs/logo.png", x: M, y: 330, width: 150, height: 150, radius: 34 })])),
  clip(f, CUE.hice + 18, display("Así que hice", M, 600, 72, "#C9D3FF", 500)),
  clip(f, CUE.hice + 22, display("fullgpu-render.", M, 690, 104, WHITE, 800)),
];

const CODE_LINES = [
  ["const s = spring({ frame, fps });", "const s = spring({ frame, fps });", "spring"],
  ["interpolate(frame, [0, 20], [0, 1])", "interpolate(frame, [0, 20], [0, 1])", "interpolate"],
  ["<Sequence from={30}>…</Sequence>", "sequence({ from: 30 }, …)", "secuencias"],
];
const sameCode = (f) => {
  const panel = (y, title, col, from) =>
    clip(f, from, [
      rect({ x: M, y, width: W - 2 * M, height: 270, radius: 18, color: SIGNAL_DEEP }),
      body(title, M + 34, y + 44, 26, "#C9D3FF", 600),
      ...CODE_LINES.map((l, i) => {
        const lit = f >= CUE[l[2]] && f < CUE[l[2]] + 40;
        return [
          lit && rect({ x: M + 18, y: y + 82 + i * 58, width: W - 2 * M - 36, height: 50, radius: 10, color: "rgba(255,255,255,0.16)" }),
          code(l[col], M + 34, y + 108 + i * 58, WHITE, 27),
        ];
      }),
    ]);
  const noBrowser = prog(f, CUE.sinNavegador, 14);
  return [
    clip(f, CUE.escribes, display("Escribes como ya sabes.", M, 260, 72, WHITE)),
    panel(360, "Remotion", 0, CUE.escribes + 8),
    panel(660, "fullgpu-render", 1, CUE.escribes + 14),
    group({ opacity: noBrowser, x: (1 - noBrowser) * 70 }, [display("Pero sin navegador.", M, 1060, 64, WHITE)]),
  ];
};

const STEPS = [
  ["NVDEC", "lee los vídeos"],
  ["wgpu", "compone cada fotograma"],
  ["NVENC", "codifica el MP4"],
];
const insideGpu = (f) => {
  const box = prog(f, CUE.dentroGPU, 18);
  return [
    clip(f, CUE.dentroGPU, display("Todo pasa dentro de la GPU.", M, 260, 72, WHITE)),
    rect({ x: M, y: 400, width: W - 2 * M, height: 640 * box, radius: 26, color: "rgba(255,255,255,0.10)" }),
    ...STEPS.map(([name, what], i) =>
      clip(f, CUE.dentroGPU + 8 + i * 6, [
        display(name, M + 50, 520 + i * 180, 76, WHITE, 800),
        body(what, M + 50, 585 + i * 180, 32, "#C9D3FF"),
        i < 2 && rect({ x: M + 50, y: 630 + i * 180, width: W - 2 * M - 100, height: 2, color: "rgba(255,255,255,0.25)" }),
      ]),
    ),
  ];
};

const result = (f) => {
  const v = interpolate(f, [CUE.ocho - 12, CUE.ocho + 12], [0, 8.7], { ...clamp, easing: Easing.out(Easing.cubic) });
  const bars = prog(f, CUE.ocho + 16, 24, Easing.inOut(Easing.cubic));
  const span = W - 2 * M;
  return [
    clip(f, CUE.mismoMinuto, display("El mismo minuto.", M, 300, 72, WHITE)),
    clip(f, CUE.ocho - 12, display(seconds(v), M - 6, 560, 230, WHITE, 700), 0),
    clip(f, CUE.ocho + 12, [
      body("Remotion", M, 780, 28, "#C9D3FF", 600),
      rect({ x: M, y: 805, width: span * bars, height: 34, radius: 8, color: "rgba(255,255,255,0.28)" }),
      body("204,1 s", W - M - 110, 780, 28, "#C9D3FF", 600),
      body("fullgpu-render", M, 900, 28, WHITE, 600),
      rect({ x: M, y: 925, width: Math.max(8, span * (8.7 / 204.1) * bars), height: 34, radius: 8, color: WHITE }),
      body("8,7 s", M + span * (8.7 / 204.1) + 24, 942, 28, WHITE, 700),
    ]),
    clip(f, CUE.veintitres, display("23 veces más rápido.", M, 1110, 80, WHITE, 800)),
  ];
};

const honest = (f) => [
  clip(f, CUE.todavia, display("Todavía no hace todo", M, 280, 72, WHITE)),
  clip(f, CUE.todavia + 4, display("lo que hace Remotion.", M, 360, 72, WHITE)),
  clip(f, CUE.todavia + 16, [
    body("Ya hace texto, formas, imágenes, vídeo y audio.", M, 490, 32, WHITE),
    body("Aún no hace HTML y CSS libres, y necesita una NVIDIA.", M, 545, 32, "#C9D3FF"),
  ]),
  clip(f, CUE.abierto, [
    image({ src: "docs/logo.png", x: M, y: 700, width: 120, height: 120, radius: 28 }),
    display("Código abierto.", M + 150, 735, 60, WHITE, 800),
    display("Pruébalo hoy.", M + 150, 800, 60, "#C9D3FF", 600),
  ]),
  clip(f, CUE.enlace, [
    display("github.com/WassimAarab08/fullgpu-render", M, 1010, 46, WHITE, 600),
    rect({ x: M, y: 1045, width: W - 2 * M, height: 3, color: WHITE }),
  ]),
];

export default composition({ width: W, height: H, fps: FPS, durationInFrames: TOTAL, background: PAPER }, ({ frame }) => {
  const sweep = interpolate(frame, [CUE.hice, CUE.hice + 18], [W, 0], { ...clamp, easing: Easing.inOut(Easing.poly(5)) });
  return [
    rect({ x: 0, y: 0, width: W, height: H, color: PAPER }),
    rect({ x: sweep, y: 0, width: W, height: H, color: SIGNAL }),
    existsSync(VOICE) && audio({ src: VOICE, from: LEAD }),
    group({ y: 110 }, [ // el contenido ocupa el centro óptico del 4:5; la regla queda arriba
    shot(0, CUE.chrome - 4, progressBar),
    shot(CUE.chrome - 6, CUE.portatil - 4, capture),
    shot(CUE.portatil - 6, CUE.medi - 4, gpuIdle),
    shot(CUE.medi - 6, CUE.hice + 4, measured),
    shot(CUE.hice + 8, CUE.escribes - 2, reveal),
    shot(CUE.escribes - 4, CUE.dentroGPU - 2, sameCode),
    shot(CUE.dentroGPU - 4, CUE.mismoMinuto - 2, insideGpu),
    shot(CUE.mismoMinuto - 4, CUE.todavia - 2, result),
    shot(CUE.todavia - 4, TOTAL, honest),
    ]),
    ...timeline(frame),
  ];
});
