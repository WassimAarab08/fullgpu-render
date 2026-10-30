// SDK de composición: describe un vídeo como una función fotograma -> nodos (como un componente de Remotion) y lo
// compila al formato del motor nativo (textos, imágenes, flujos de vídeo y lista de dibujo por fotograma).
//
//   export default composition({ width: 1920, height: 1080, fps: 30, durationInFrames: 150 }, ({ frame }) => [
//     rect({ x: 0, y: 0, width: 1920, height: 1080, gradient: { from: "#0b1020", to: "#1d3a8a", angle: 135 } }),
//     text({ text: "Hola", x: 960, y: 540, size: 120, opacity: interpolate(frame, [0, 20], [0, 1]) }),
//   ]);
import { execFileSync } from "node:child_process";
import { parseColor } from "./animation.mjs";

export const composition = (config, render) => ({ fps: 30, background: "#000000", ...config, render });

/** Rectángulo redondeado: { x, y, width, height, radius, color | gradient: { from, to, angle }, shadow: { y, blur, color }, opacity } */
export const rect = (props) => ({ type: "rect", ...props });
/**
 * Texto centrado en (x, y): { text, x, y, size, weight, color, font, align: "center" | "left", maxWidth, anchor: "center" | "bottom",
 * background, scale, opacity, lineHeight (px), textAlign (líneas partidas: "left" | "center" | "right") }
 */
export const text = (props) => ({ type: "text", ...props });
/** Imagen: { src, x, y, width, height, radius, opacity } */
export const image = (props) => ({ type: "image", ...props });
/** Vídeo: { src, x, y, width, height, radius, from, durationInFrames, startFrom (s), playbackRate, fit: "cover" | "contain" | "fill", opacity } */
export const video = (props) => ({ type: "video", ...props });
/** Audio: { src, from, startFrom (s), durationInSeconds }. Por ahora todos los clips deben salir del mismo archivo. */
export const audio = (props) => ({ type: "audio", ...props });
/** Grupo: desplaza ({ x, y }), escala desde su origen ({ scale }) y multiplica la opacidad de sus hijos. */
export const group = (props, children) => ({ type: "group", ...props, children });
/** Tramo de tiempo: `render(frameLocal)` solo se llama entre `from` y `from + durationInFrames`. */
export const sequence = ({ from = 0, durationInFrames = Infinity }, render) => ({ type: "sequence", from, durationInFrames, render });

const rgba = (css) => {
  const [r, g, b, a] = parseColor(css);
  return [r / 255, g / 255, b / 255, a];
};
const hex = (css) => "#" + parseColor(css).slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const even = (v) => Math.max(2, Math.ceil(v / 2) * 2);

function ffprobeSize(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
  const [w, h] = String(out).trim().split("x").map(Number);
  return { w, h };
}

/**
 * Compila una composición. `mediaRoot` es la carpeta desde la que se resuelven `src`; `probe(src)` devuelve el tamaño
 * de un vídeo (por defecto ffprobe).
 */
export async function compile(comp, { mediaRoot = ".", probe = async (src) => ffprobeSize(`${mediaRoot}/${src}`) } = {}) {
  const { width, height, fps, durationInFrames, background, render } = comp;
  const texts = [];
  const textIds = new Map();
  const images = [];
  const imageIds = new Map();
  const streams = new Map();
  const sizes = new Map();
  const clips = new Map();

  const textId = (spec) => {
    const key = JSON.stringify(spec);
    if (!textIds.has(key)) {
      textIds.set(key, `t${texts.length}`);
      texts.push({ id: `t${texts.length}`, ...spec });
    }
    return textIds.get(key);
  };
  const imageId = (src) => {
    if (!imageIds.has(src)) {
      imageIds.set(src, `img${images.length}`);
      images.push({ id: `img${images.length}`, file: src });
    }
    return imageIds.get(src);
  };

  const frames = [];
  for (let f = 0; f < durationInFrames; f++) {
    const draws = [];
    const ctx = { frame: f, start: 0, end: durationInFrames, tx: 0, ty: 0, s: 1, o: 1 };
    const tree = await render({ frame: f, fps, width, height, durationInFrames });
    await walk(tree, ctx, draws);
    frames.push({ draws });
  }

  async function walk(node, ctx, draws) {
    if (!node) return; // como React: "", 0, false, null y undefined no pintan nada
    if (Array.isArray(node)) {
      for (const n of node) await walk(n, ctx, draws);
      return;
    }
    const pt = (x, y) => [ctx.tx + x * ctx.s, ctx.ty + y * ctx.s];
    const box = (n) => [...pt(n.x ?? 0, n.y ?? 0), (n.width ?? 0) * ctx.s, (n.height ?? 0) * ctx.s];
    const opacity = ctx.o * (node.opacity ?? 1);

    switch (node.type) {
      case "group": {
        const [tx, ty] = pt(node.x ?? 0, node.y ?? 0);
        await walk(node.children, { ...ctx, tx, ty, s: ctx.s * (node.scale ?? 1), o: opacity }, draws);
        return;
      }
      case "sequence": {
        const local = ctx.frame - node.from;
        if (local < 0 || local >= node.durationInFrames) return;
        const start = ctx.start + node.from;
        const end = Math.min(ctx.end, start + node.durationInFrames);
        await walk(node.render(local), { ...ctx, frame: local, start, end }, draws);
        return;
      }
    }
    if (opacity <= 0) return;

    switch (node.type) {
      case "rect": {
        const r = box(node);
        const radius = (node.radius ?? 0) * ctx.s;
        if (node.shadow) {
          const sh = [r[0] + (node.shadow.x ?? 0) * ctx.s, r[1] + (node.shadow.y ?? 0) * ctx.s, r[2], r[3]];
          const m = (node.shadow.blur ?? 0) * ctx.s;
          draws.push({ kind: "shape", rect: sh, quad: [sh[0] - m, sh[1] - m, sh[2] + 2 * m, sh[3] + 2 * m], radius, softness: Math.max(1, m), color: rgba(node.shadow.color ?? "rgba(0,0,0,0.3)"), opacity });
        }
        const d = { kind: "shape", rect: r, quad: r, radius, softness: 1, color: rgba(node.gradient?.from ?? node.color ?? "#ffffff"), opacity };
        if (node.gradient) {
          // Ángulo CSS: 0deg hacia arriba, 90deg hacia la derecha.
          const a = ((node.gradient.angle ?? 180) * Math.PI) / 180;
          d.gradient = { to: rgba(node.gradient.to), dir: [Math.sin(a), -Math.cos(a)] };
        }
        draws.push(d);
        return;
      }
      case "text": {
        const spec = { text: String(node.text), fontSize: node.size ?? 48, color: hex(node.color ?? "#ffffff"), weight: node.weight ?? 600 };
        if (node.maxWidth) spec.maxWidth = node.maxWidth;
        if (node.font) spec.font = node.font;
        if (node.lineHeight) spec.lineHeight = node.lineHeight;
        if (node.textAlign) spec.textAlign = node.textAlign;
        const [cx, cy] = pt(node.x ?? 0, node.y ?? 0);
        const d = { kind: "text", id: textId(spec), cx, cy, opacity, scale: (node.scale ?? 1) * ctx.s };
        if (node.anchor === "bottom") d.anchorBottom = true;
        if (node.align === "left") d.align = "left";
        if (node.background) {
          const b = node.background;
          d.bg = { color: rgba(b.color ?? "#000000"), padX: (b.padX ?? 0) * ctx.s, padY: (b.padY ?? 0) * ctx.s, radius: (b.radius ?? 0) * ctx.s };
        }
        draws.push(d);
        return;
      }
      case "audio": {
        const from = ctx.start + (node.from ?? 0);
        const startFrom = node.startFrom ?? 0;
        const key = `${node.src}|${from}|${startFrom}`;
        if (!clips.has(key)) {
          clips.set(key, { src: node.src, fromSec: from / fps, srcStartSec: startFrom, durationSec: node.durationInSeconds ?? (ctx.end - from) / fps });
        }
        return;
      }
      case "image": {
        draws.push({ kind: "image", id: imageId(node.src), quad: box(node), radius: (node.radius ?? 0) * ctx.s, opacity });
        return;
      }
      case "video": {
        const from = ctx.start + (node.from ?? 0);
        const frames = node.durationInFrames ?? ctx.end - from;
        const absFrame = ctx.start + ctx.frame;
        if (absFrame < from || absFrame >= from + frames) return;
        const startFrom = node.startFrom ?? 0;
        const rate = node.playbackRate ?? 1;
        const key = node.id ?? `${node.src}|${from}|${startFrom}|${rate}`;
        if (!sizes.has(node.src)) sizes.set(node.src, await probe(node.src));
        const src = sizes.get(node.src);
        let r = box(node);
        let uv = [0, 0, 1, 1];
        let visible = [1, 1];
        if (node.fit === "contain") {
          const scale = Math.min(r[2] / src.w, r[3] / src.h);
          const [w, h] = [src.w * scale, src.h * scale];
          r = [r[0] + (r[2] - w) / 2, r[1] + (r[3] - h) / 2, w, h];
        } else if ((node.fit ?? "cover") === "cover") {
          const scale = Math.max(r[2] / src.w, r[3] / src.h);
          visible = [Math.min(1, r[2] / scale / src.w), Math.min(1, r[3] / scale / src.h)];
          uv = [(1 - visible[0]) / 2, (1 - visible[1]) / 2, (1 + visible[0]) / 2, (1 + visible[1]) / 2];
        }
        if (!streams.has(key)) {
          streams.set(key, { id: `v${streams.size}`, file: node.src, srcStartSec: startFrom, rate, from, frames, w: 2, h: 2, srcW: src.w, srcH: src.h });
        }
        const s = streams.get(key);
        // Decodifica a la resolución con la que se ve (lo visible ocupa r[2] px), sin pasar del tamaño de la fuente.
        const w = Math.min(src.w, r[2] / visible[0]);
        if (w > s.w) {
          s.w = even(w);
          s.h = even((s.w * src.h) / src.w);
        }
        draws.push({ kind: "video", source: s.id, rect: r, quad: r, radius: (node.radius ?? 0) * ctx.s, softness: 1, opacity, uv });
        return;
      }
      default:
        throw new Error(`nodo desconocido: ${node.type}`);
    }
  }

  const files = new Set([...clips.values()].map((c) => c.src));
  if (files.size > 1) throw new Error(`el motor mezcla audio de un solo archivo por ahora (hay ${files.size})`);
  return {
    scene: { width, height, fps, background: hex(background), texts },
    streams: [...streams.values()].map(({ srcW, srcH, ...s }) => s),
    audio: files.size ? { file: [...files][0], clips: [...clips.values()].map(({ src, ...c }) => c) } : null,
    images,
    frames,
  };
}
