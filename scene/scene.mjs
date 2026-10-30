// Modelo de escena del benchmark: una función pura fotograma -> capas.
// La usan las tres variantes (navegador, Rust y Remotion) para dibujar exactamente lo mismo.
// `node scene/scene.mjs > out/layout.json` vuelca todos los fotogramas para la variante Rust.

const W = 1920;
const H = 1080;
const FPS = 30;
const T0 = 900; // inicio de la transición (30 s)
const TN = 30; // duración de la transición (1 s)

export const SCENE = {
  width: W,
  height: H,
  fps: FPS,
  durationSec: 60,
  background: "#F4F1EC",
  bezelColor: "#121214",
  sources: {
    phone: { file: "phone.mp4", w: 1080, h: 2340, offsetSec: 60 },
    tablet: { file: "tablet.mp4", w: 1600, h: 1112, offsetSec: 30 },
  },
  texts: [
    { id: "title1", text: "Rendered on the GPU · 视频渲染", fontSize: 64, color: "#1F1F1F", cx: W / 2, cy: 105 },
    { id: "title2", text: "Rendered on the GPU — تصيير الفيديو", fontSize: 64, color: "#1F1F1F", cx: W / 2, cy: 105 },
  ],
};

// Posición de la pantalla (sin marco) antes (a) y después (b) de la transición; la altura sale de la fuente.
const LAYOUT = {
  tablet: { a: { x: 800, y: 230, w: 960 }, b: { x: 120, y: 190, w: 1240 }, radius: 24, bezel: 20 },
  phone: { a: { x: 300, y: 200, w: 380 }, b: { x: 1460, y: 230, w: 360 }, radius: 44, bezel: 16 },
};
const DRAW_ORDER = ["tablet", "phone"];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a, b, p) => a + (b - a) * p;
// Progreso suavizado de una rampa que empieza en `from` y dura `len` fotogramas.
const ramp = (f, from, len) => ease(clamp01((f - from) / len));

export function frameAt(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= FPS * SCENE.durationSec) {
    throw new RangeError(`fotograma fuera de rango: ${frame}`);
  }
  const transition = ramp(frame, T0, TN);

  const devices = DRAW_ORDER.map((source) => {
    const l = LAYOUT[source];
    const src = SCENE.sources[source];
    const w = lerp(l.a.w, l.b.w, transition);
    return {
      source,
      screen: { x: lerp(l.a.x, l.b.x, transition), y: lerp(l.a.y, l.b.y, transition), w, h: (w * src.h) / src.w },
      radius: l.radius,
      bezel: l.bezel,
      sourceTime: src.offsetSec + frame / FPS,
    };
  });

  const in1 = ramp(frame, 0, 30);
  const out1 = ramp(frame, T0, 15);
  const in2 = ramp(frame, T0 + 15, 30);
  const texts = [
    { id: "title1", opacity: in1 * (1 - out1), dy: 40 * (1 - in1) },
    { id: "title2", opacity: in2, dy: 40 * (1 - in2) },
  ];

  return { frame, transition, devices, texts };
}

const rgba = (hex, a = 1) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(a);
const SHADOW = { dy: 40, blur: 80, color: [31 / 255, 31 / 255, 31 / 255, 0.28] }; // como el box-shadow de Devices.tsx

// Primitivas que ejecuta el compositor (mismo shader en navegador y Rust). Rectángulos en px: [x, y, w, h].
// shape = rectángulo redondeado de color con borde suave; video = pantalla recortada; text = textura centrada en (cx, cy).
export function drawList(fr) {
  const draws = [];
  for (const d of fr.devices) {
    const s = [d.screen.x, d.screen.y, d.screen.w, d.screen.h];
    const b = d.bezel;
    const outer = [s[0] - b, s[1] - b, s[2] + 2 * b, s[3] + 2 * b];
    const shadowRect = [outer[0], outer[1] + SHADOW.dy, outer[2], outer[3]];
    const m = SHADOW.blur;
    draws.push({
      kind: "shape", source: d.source, rect: shadowRect, radius: d.radius + b, softness: m, color: SHADOW.color, opacity: 1,
      quad: [shadowRect[0] - m, shadowRect[1] - m, shadowRect[2] + 2 * m, shadowRect[3] + 2 * m],
    });
    draws.push({ kind: "shape", source: d.source, rect: outer, quad: outer, radius: d.radius + b, softness: 1, color: rgba(SCENE.bezelColor), opacity: 1 });
    draws.push({ kind: "video", source: d.source, rect: s, quad: s, radius: d.radius, softness: 1, opacity: 1, sourceTime: d.sourceTime });
  }
  for (const t of fr.texts) {
    if (t.opacity <= 0) continue;
    const spec = SCENE.texts.find((x) => x.id === t.id);
    draws.push({ kind: "text", id: t.id, cx: spec.cx, cy: spec.cy + t.dy, opacity: t.opacity });
  }
  return draws;
}

// Formato del motor nativo (el mismo que emite timeline/compile.mjs): un flujo por fuente, decodificado al mayor
// tamaño con el que aparece en pantalla (par, con la proporción de la fuente); el escalado lo hace scale_cuda.
export function dumpLayout() {
  const n = FPS * SCENE.durationSec;
  const frames = [];
  for (let f = 0; f < n; f++) {
    const fr = frameAt(f);
    frames.push({ ...fr, draws: drawList(fr) });
  }
  const even = (v) => v + (v % 2);
  const streams = Object.entries(SCENE.sources).map(([id, src]) => {
    const maxW = Math.max(...frames.flatMap((fr) => fr.devices.filter((d) => d.source === id).map((d) => d.screen.w)));
    const w = even(Math.min(src.w, Math.ceil(maxW)));
    return { id, file: `media/${src.file}`, srcStartSec: src.offsetSec, rate: 1, from: 0, frames: n, w, h: even(Math.round((w * src.h) / src.w)) };
  });
  const texts = SCENE.texts.map((t) => ({ ...t, weight: 600 }));
  return { scene: { ...SCENE, texts }, streams, audio: null, frames };
}

const cliArg = typeof process !== "undefined" ? process.argv?.[1] : undefined;
if (cliArg && import.meta.url.endsWith(cliArg.replace(/\\/g, "/").split("/").pop())) {
  process.stdout.write(JSON.stringify(dumpLayout()));
}
