// Núcleo de animación con la misma API que Remotion (interpolate, spring, measureSpring, Easing, interpolateColors),
// implementado de cero: muelle amortiguado con solución analítica avanzada fotograma a fotograma y las curvas de
// easing clásicas (cuadrática, cúbica, bezier, elástica, rebote...). Los tests lo comparan con Remotion.

// ── interpolate ────────────────────────────────────────────────────────────────────────────────

const checkRanges = (inputRange, outputRange) => {
  if (!Array.isArray(inputRange) || !Array.isArray(outputRange) || inputRange.length !== outputRange.length) {
    throw new Error("inputRange y outputRange deben ser arrays de la misma longitud");
  }
  if (inputRange.length < 2) throw new Error("inputRange necesita al menos 2 valores");
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i] > inputRange[i - 1])) throw new Error("inputRange debe ser estrictamente creciente");
  }
};

const extrapolate = (x, min, max, left, right) => {
  const range = max - min;
  if (x < min) {
    if (left === "identity") return { identity: true, x };
    if (left === "clamp") return { x: min };
    if (left === "wrap") return { x: ((((x - min) % range) + range) % range) + min };
  }
  if (x > max) {
    if (right === "identity") return { identity: true, x };
    if (right === "clamp") return { x: max };
    if (right === "wrap") return { x: ((((x - min) % range) + range) % range) + min };
  }
  return { x };
};

export function interpolate(input, inputRange, outputRange, options = {}) {
  checkRanges(inputRange, outputRange);
  const { easing = (t) => t, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  // Tramo que contiene la entrada (el primero o el último si se sale del rango).
  let i = 1;
  while (i < inputRange.length - 1 && inputRange[i] < input) i++;
  const [inMin, inMax] = [inputRange[i - 1], inputRange[i]];
  const [outMin, outMax] = [outputRange[i - 1], outputRange[i]];
  const e = extrapolate(input, inMin, inMax, extrapolateLeft, extrapolateRight);
  if (e.identity) return e.x;
  if (outMin === outMax) return outMin;
  const ease = typeof easing === "function" ? easing : easing[i - 1];
  return ease((e.x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

// ── spring ─────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_SPRING = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };
const resolveSpring = (config = {}) => ({ ...DEFAULT_SPRING, ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) });

// Avanza un muelle (posición, velocidad) hacia `to` durante `dtMs` con la solución analítica del oscilador
// amortiguado; con ζ >= 1 se usa la forma críticamente amortiguada. Pasos de 64 ms como máximo.
function step(state, nowMs, { damping: c, mass: m, stiffness: k }) {
  if (c <= 0) throw new Error("spring: damping debe ser mayor que 0");
  const t = Math.min(nowMs - state.time, 64) / 1000;
  const v0 = -state.velocity;
  const x0 = state.to - state.position;
  const zeta = c / (2 * Math.sqrt(k * m));
  const w0 = Math.sqrt(k / m);
  if (zeta < 1) {
    const w1 = w0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * w0 * t);
    const sin = Math.sin(w1 * t);
    const cos = Math.cos(w1 * t);
    const frag = env * (sin * ((v0 + zeta * w0 * x0) / w1) + x0 * cos);
    return {
      time: nowMs,
      to: state.to,
      position: state.to - frag,
      velocity: zeta * w0 * frag - env * (cos * (v0 + zeta * w0 * x0) - w1 * x0 * sin),
    };
  }
  const env = Math.exp(-w0 * t);
  return {
    time: nowMs,
    to: state.to,
    position: state.to - env * (x0 + (v0 + w0 * x0) * t),
    velocity: env * (v0 * (t * w0 - 1) + t * x0 * w0 * w0),
  };
}

// Muelle normalizado de 0 a 1 evaluado en un fotograma (admite fracciones).
function springAt(frame, fps, config) {
  const f = Math.max(0, frame);
  let s = { time: 0, to: 1, position: 0, velocity: 0 };
  for (let i = 0; i <= Math.floor(f); i++) s = step(s, (i / fps) * 1000, config);
  if (f % 1 > 0) s = step(s, (f / fps) * 1000, config);
  return s.position;
}

const measureCache = new Map();

/** Fotogramas que tarda el muelle en quedarse (20 fotogramas seguidos) a menos de `threshold` del final. */
export function measureSpring({ fps, config = {}, threshold = 0.005 }) {
  if (threshold === 0) return Infinity;
  if (threshold === 1) return 0;
  if (!(threshold > 0 && threshold < 1)) throw new TypeError("threshold debe estar entre 0 y 1");
  const cfg = resolveSpring(config);
  const key = JSON.stringify([fps, cfg, threshold]);
  if (measureCache.has(key)) return measureCache.get(key);
  // Avance incremental: mismo resultado que springAt fotograma a fotograma, sin repetir el cálculo.
  let s = step({ time: 0, to: 1, position: 0, velocity: 0 }, 0, cfg);
  let frame = 0;
  const next = () => {
    frame++;
    s = step(s, (frame / fps) * 1000, cfg);
    return Math.abs(s.position - 1);
  };
  let diff = Math.abs(s.position - 1);
  while (diff >= threshold) diff = next();
  let finished = frame;
  for (let i = 0; i < 20; i++) {
    if (next() >= threshold) {
      i = 0;
      finished = frame + 1;
    }
  }
  measureCache.set(key, finished);
  return finished;
}

export function spring({ frame, fps, config = {}, from = 0, to = 1, durationInFrames, durationRestThreshold, delay = 0, reverse = false }) {
  if (!(fps > 0)) throw new Error("spring: fps debe ser positivo");
  const cfg = resolveSpring(config);
  const natural = reverse || durationInFrames !== undefined ? measureSpring({ fps, config: cfg, threshold: durationRestThreshold }) : undefined;
  const reversed = reverse ? (durationInFrames ?? natural) - frame : frame;
  const delayed = reversed + (reverse ? delay : -delay);
  if (durationInFrames && delayed > durationInFrames) return to;
  const t = durationInFrames === undefined ? delayed : delayed / (durationInFrames / natural);
  let v = springAt(t, fps, cfg);
  if (cfg.overshootClamping) v = Math.min(v, 1);
  return from === 0 && to === 1 ? v : interpolate(v, [0, 1], [from, to]);
}

// ── Easing ─────────────────────────────────────────────────────────────────────────────────────

// Bezier cúbica (0,0)-(x1,y1)-(x2,y2)-(1,1): resuelve x(t) = x con Newton y, si no converge, bisección.
function bezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x1 === y1 && x2 === y2 ? x : sy(solve(x)));
}

export const Easing = {
  linear: (t) => t,
  ease: (t) => Easing.bezier(0.42, 0, 1, 1)(t),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  poly: (n) => (t) => t ** n,
  sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t) => 1 - Math.sqrt(1 - t * t),
  exp: (t) => 2 ** (10 * (t - 1)),
  elastic: (bounciness = 1) => {
    const p = bounciness * Math.PI;
    return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
  },
  back: (s = 1.70158) => (t) => t * t * ((s + 1) * t - s),
  bounce: (t) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
  bezier,
  in: (e) => e,
  out: (e) => (t) => 1 - e(1 - t),
  inOut: (e) => (t) => (t < 0.5 ? e(t * 2) / 2 : 1 - e((1 - t) * 2) / 2),
};

// ── Colores ────────────────────────────────────────────────────────────────────────────────────

const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", transparent: "#00000000",
};

/** Color CSS (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), nombres básicos) -> [r, g, b, a] con r,g,b en 0..255 y a en 0..1. */
export function parseColor(css) {
  const s = (NAMED[css.trim().toLowerCase()] ?? css).trim();
  if (s.startsWith("#")) {
    const h = s.length <= 5 ? [...s.slice(1)].map((c) => c + c).join("") : s.slice(1);
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1];
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) throw new Error(`color no soportado: ${css}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

export function interpolateColors(input, inputRange, outputRange) {
  const colors = outputRange.map(parseColor);
  const ch = (k) => interpolate(input, inputRange, colors.map((c) => c[k]), { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [r, g, b] = [0, 1, 2].map((k) => Math.round(ch(k)));
  const a = ch(3);
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}
