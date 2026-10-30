// Sustituto de `remotion` para el bundle de fullgpu-render: componentes y hooks de la API de Remotion 4 evaluados
// por el runtime propio. Los vídeos, audios e imágenes salen como nodos anfitrión que la capa de layout traduce al motor.
import { createElement as h, Fragment, Children, createContext, useContext, Timeline, CompositionCollector, setRoot } from "./runtime.mjs";

export { interpolate, spring, measureSpring, Easing, interpolateColors } from "../animation.mjs";

const timeline = () => {
  const t = useContext(Timeline);
  if (!t) throw new Error("useCurrentFrame() can only be called while rendering a composition");
  return t;
};

export const useCurrentFrame = () => timeline().frame;
export const useVideoConfig = () => {
  const t = timeline();
  return { ...t.config, durationInFrames: t.duration };
};
export const useCurrentScale = () => 1;
export const getInputProps = () => ({});
export const getRemotionEnvironment = () => ({ isStudio: false, isRendering: true, isPlayer: false, isReadOnlyStudio: false, isClientSideRendering: false });

let handles = 0;
export const delayRender = () => ++handles;
export const continueRender = () => {};
export const cancelRender = (err) => {
  throw err instanceof Error ? err : new Error(String(err));
};
export const prefetch = () => ({ free: () => {}, waitUntilDone: () => Promise.resolve() });

/** staticFile("x.mp4") -> "x.mp4": las rutas se resuelven desde la carpeta de medios (--media-root, como --public-dir). */
export const staticFile = (path) => String(path).replace(/^\/+/, "");
const mediaSrc = (src) => (/^[a-z]+:/i.test(src) ? src : staticFile(src));

export const AbsoluteFill = ({ style, children, ...rest }) =>
  h("div", { ...rest, style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", ...style } }, children);

const withTimeline = (value, layout, style, children, rest = {}) =>
  h(Timeline.Provider, { value }, layout === "none" ? children : h(AbsoluteFill, { ...rest, style }, children));

export function Sequence({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", style, name, showInTimeline, premountFor, postmountFor, children, ...rest }) {
  const t = timeline();
  const frame = t.frame - from;
  if (frame < 0 || frame >= durationInFrames) return null;
  const start = t.start + from;
  const value = { ...t, frame, start, end: Math.min(t.end, start + durationInFrames), duration: Number.isFinite(durationInFrames) ? durationInFrames : t.duration };
  return withTimeline(value, layout, style, children, rest);
}

function SeriesSequence() {
  throw new Error("<Series.Sequence> can only be used inside <Series>");
}

export function Series({ children }) {
  let from = 0;
  const parts = Children.toArray(children).map((child) => {
    if (child.type !== SeriesSequence) throw new Error("<Series> only accepts <Series.Sequence> children");
    const { durationInFrames, offset = 0, ...rest } = child.props;
    from += offset;
    const el = h(Sequence, { ...rest, key: child.key, from, durationInFrames });
    from += durationInFrames;
    return el;
  });
  return h(Fragment, null, parts);
}
Series.Sequence = SeriesSequence;

export function Loop({ durationInFrames, times = Infinity, layout = "absolute-fill", style, name, children }) {
  const t = timeline();
  const iteration = Math.floor(t.frame / durationInFrames);
  if (t.frame < 0 || iteration >= times) return null;
  const start = t.start + iteration * durationInFrames;
  const value = { ...t, frame: t.frame % durationInFrames, start, end: Math.min(t.end, start + durationInFrames), duration: durationInFrames };
  return withTimeline(value, layout, style, children);
}

export function Freeze({ frame, active = true, children }) {
  const t = timeline();
  const on = typeof active === "function" ? active(t.frame) : active;
  return on ? h(Timeline.Provider, { value: { ...t, frame } }, children) : children;
}

export const Img = ({ src, ...rest }) => h("img", { ...rest, src: mediaSrc(src) });

/** Nodo anfitrión de vídeo o audio con su tramo absoluto y el punto de inicio en la fuente. */
function media(tag, { src, trimBefore, trimAfter, startFrom, endAt, playbackRate = 1, muted = tag === "video" ? false : false, volume = 1, loop, ...rest }) {
  const t = timeline();
  const { fps } = t.config;
  const before = trimBefore ?? startFrom ?? 0;
  const after = trimAfter ?? endAt;
  const end = after == null ? t.end : Math.min(t.end, t.start + (after - before) / playbackRate);
  if (t.start + t.frame >= end) return null;
  const __media = { start: t.start, end, startFromSec: before / fps, rate: playbackRate, muted, volume };
  return h(tag, { ...rest, src: mediaSrc(src), __media });
}

export const Video = (props) => media("video", props);
export const OffthreadVideo = Video;
export const Html5Video = Video;
export const Audio = (props) => media("audio", props);
export const Html5Audio = Audio;

/** Durante getCompositions() registra la composición; al renderizar no pinta nada. */
export function Composition({ id, component, lazyComponent, durationInFrames, fps, width, height, defaultProps = {}, calculateMetadata, schema }) {
  const found = useContext(CompositionCollector);
  if (found) found.push({ id, component: component ?? lazyComponent, durationInFrames, fps, width, height, defaultProps, calculateMetadata });
  return null;
}
export const Still = (props) => h(Composition, { durationInFrames: 1, fps: 1, ...props });
export const Folder = ({ children }) => h(Fragment, null, children);
export const registerRoot = setRoot;

// random() determinista de Remotion: mismo valor para la misma semilla.
function mulberry32(a) {
  let t = a + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
export function random(seed) {
  if (seed === null) return Math.random();
  if (typeof seed === "string") return mulberry32(hashCode(seed));
  if (typeof seed === "number") return mulberry32(seed * 10000000000);
  throw new Error("random() argument must be a number or a string");
}

export const Internals = {};
export const VERSION = "4.0.0-fullgpu";
