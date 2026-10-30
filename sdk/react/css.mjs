// Traductor de valores CSS de `style={{...}}` a números y estructuras que entiende el layout. Lo que el motor no sabe
// pintar (rotaciones, sombras interiores, calc()...) lanza un error con el nombre de la propiedad: el layout lo convierte
// en un aviso y sigue sin ese efecto.
import { parseColor } from "../animation.mjs";

/** Divide por comas (o espacios) de primer nivel, sin partir lo que hay dentro de paréntesis. */
export function splitTop(s, sep = ",") {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    const isSep = sep === " " ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Longitud CSS -> px (número), { percent }, "auto" o undefined. `fontSize` para em. */
export function length(v, { fontSize = 16 } = {}) {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "auto") return "auto";
  const m = s.match(/^(-?[\d.]+)(px|%|em|rem)?$/);
  if (!m) throw new Error(`length "${s}" is not supported (use px, %, em or rem)`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "%":
      return { percent: n };
    case "em":
      return n * fontSize;
    case "rem":
      return n * 16;
    default:
      return n;
  }
}

/** Color CSS -> [r, g, b, a] (0..255, alfa 0..1). Añade hsl()/hsla() a lo que entiende parseColor. */
export function color(css) {
  const m = String(css).trim().match(/^hsla?\(([^)]+)\)$/i);
  if (!m) return parseColor(String(css));
  const [h, s, l, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith("%") ? Number(p.slice(0, -1)) / 100 : Number(p.replace("deg", ""))));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const k = l - c / 2;
  return [r, g, b].map((v) => Math.round((v + k) * 255)).concat(a);
}

const SIDES = { top: 0, right: 90, bottom: 180, left: 270 };

/** background / backgroundColor / backgroundImage -> { color } o { gradient: { from, to, angle } } o null. */
export function background(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "none" || s === "") return null;
  const g = s.match(/^linear-gradient\((.*)\)$/i);
  if (!g) {
    if (/gradient\(|url\(/i.test(s)) throw new Error(`background "${s.slice(0, 40)}" is not supported (only colors and linear-gradient)`);
    return { color: s };
  }
  const parts = splitTop(g[1]);
  let angle = 180;
  const first = parts[0];
  if (/^-?[\d.]+(deg|turn)$/.test(first)) {
    angle = first.endsWith("turn") ? parseFloat(first) * 360 : parseFloat(first);
    parts.shift();
  } else if (first.startsWith("to ")) {
    const dirs = first.slice(3).trim().split(/\s+/).map((d) => SIDES[d]);
    angle = dirs.length === 2 ? (dirs.includes(0) && dirs.includes(270) ? 315 : (dirs[0] + dirs[1]) / 2) : dirs[0];
    parts.shift();
  }
  const stop = (p) => splitTop(p, " ")[0];
  return { gradient: { from: stop(parts[0]), to: stop(parts.at(-1)), angle } };
}

/** box-shadow -> { x, y, blur, spread, color } (solo la primera sombra) o null. */
export function boxShadow(v) {
  if (v == null || String(v).trim() === "none") return null;
  const first = splitTop(String(v))[0];
  if (/\binset\b/.test(first)) throw new Error("boxShadow inset is not supported");
  const tokens = splitTop(first, " ");
  const nums = [];
  let col = "rgba(0,0,0,1)";
  for (const t of tokens) {
    if (/^-?[\d.]+(px)?$/.test(t)) nums.push(parseFloat(t));
    else col = t;
  }
  const [x = 0, y = 0, blur = 0, spread = 0] = nums;
  return { x, y, blur, spread, color: col };
}

const num = (s, size) => {
  const t = s.trim();
  if (t.endsWith("%")) return (parseFloat(t) / 100) * size;
  return parseFloat(t);
};

/**
 * transform -> { tx, ty, scale }: p' = t + scale * p (alrededor del transform-origin, que aplica el layout).
 * Las funciones se componen en orden, como en CSS. `w`, `h`: tamaño de la caja, para los porcentajes.
 */
export function transform(v, w, h) {
  const out = { tx: 0, ty: 0, scale: 1 };
  if (v == null || String(v).trim() === "none") return out;
  for (const fn of String(v).matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const [, name, raw] = fn;
    const args = raw.split(",").map((a) => a.trim());
    const translate = (x, y) => {
      out.tx += out.scale * x;
      out.ty += out.scale * y;
    };
    switch (name) {
      case "translate":
      case "translate3d":
        translate(num(args[0], w), args[1] ? num(args[1], h) : 0);
        break;
      case "translateX":
        translate(num(args[0], w), 0);
        break;
      case "translateY":
        translate(0, num(args[0], h));
        break;
      case "scale":
      case "scale3d": {
        const sx = parseFloat(args[0]);
        const sy = args[1] ? parseFloat(args[1]) : sx;
        if (Math.abs(sx - sy) > 1e-6) throw new Error(`transform scale(${raw}) with different x and y is not supported`);
        out.scale *= sx;
        break;
      }
      case "rotate":
      case "rotateZ":
        if (parseFloat(args[0]) !== 0) throw new Error(`transform rotate(${raw}) is not supported yet`);
        break;
      default:
        throw new Error(`transform ${name}() is not supported`);
    }
  }
  return out;
}

const WEIGHTS = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
export const fontWeight = (v) => (typeof v === "number" ? v : WEIGHTS[v] ?? Number(v));

/** Atajo `font: [style] [weight] size[/line-height] family`. */
export function font(v) {
  const tokens = splitTop(String(v), " ");
  const out = {};
  let i = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "italic" || t === "oblique") out.fontStyle = t;
    else if (t in WEIGHTS || /^[1-9]00$/.test(t)) out.fontWeight = fontWeight(t);
    else if (t === "normal" || t === "small-caps") continue;
    else break;
  }
  const [size, lh] = tokens[i].split("/");
  out.fontSize = length(size);
  if (lh) out.lineHeight = /^[\d.]+$/.test(lh) ? Number(lh) : lh;
  out.fontFamily = tokens.slice(i + 1).join(" ");
  return out;
}

/** Atajo `border: width style color` -> { width, color } o null. */
export function border(v) {
  if (v == null || String(v).trim() === "none" || String(v).trim() === "0") return null;
  const out = { width: 3, color: "#000000" };
  for (const t of splitTop(String(v), " ")) {
    if (/^-?[\d.]+(px)?$/.test(t)) out.width = parseFloat(t);
    else if (!/^(solid|dashed|dotted|double|none|hidden)$/.test(t)) out.color = t;
  }
  return out;
}
