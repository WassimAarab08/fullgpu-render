// Layout de un fotograma: nodos anfitrión (div, img, video, audio, texto) con estilos CSS -> flexbox con Yoga -> nodos
// del SDK (rect, text, image, video, audio, group). Los textos se miden con el mismo rasterizador que los pinta
// (`fullgpu-render --measure`), en rondas: Yoga pide tamaños, los que faltan se miden y se vuelve a calcular.
// Lo que el motor no sabe pintar se avisa una vez por `warn` y se omite.
import Yoga, { Align, Direction, Display, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, Wrap } from "yoga-layout";
import * as css from "./css.mjs";

const ROOT_TEXT = { color: "#000000", fontFamily: '"Times New Roman", serif', fontSize: 16, fontWeight: 400, lineHeight: "normal", textAlign: "left", textTransform: "none", whiteSpace: "normal" };
const INHERITED = Object.keys(ROOT_TEXT);
// Hoja de estilos del navegador para las etiquetas que más se usan en vídeos.
const UA = {
  h1: { fontSize: "2em", fontWeight: 700, marginTop: "0.67em", marginBottom: "0.67em" },
  h2: { fontSize: "1.5em", fontWeight: 700, marginTop: "0.83em", marginBottom: "0.83em" },
  h3: { fontSize: "1.17em", fontWeight: 700, marginTop: "1em", marginBottom: "1em" },
  p: { marginTop: "1em", marginBottom: "1em" },
  strong: { fontWeight: 700 },
  b: { fontWeight: 700 },
};
const INLINE = new Set(["span", "strong", "b", "em", "i", "a", "small", "code", "u", "mark", "sup", "sub", "label", "br"]);
const LAYOUT_PROPS = new Set([
  "display", "position", "top", "left", "right", "bottom", "inset", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock",
  "flex", "flexGrow", "flexShrink", "flexBasis", "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignSelf", "alignContent",
  "gap", "rowGap", "columnGap", "aspectRatio", "overflow", "boxSizing",
]);
const PAINT_PROPS = new Set([
  "background", "backgroundColor", "backgroundImage", "borderRadius", "boxShadow", "border", "borderWidth", "borderColor", "borderStyle",
  "opacity", "transform", "transformOrigin", "objectFit", "font", "fontStyle", "zIndex", "pointerEvents", "userSelect", "willChange", ...INHERITED,
]);

const caches = new WeakMap();

/**
 * Calcula el layout de un fotograma y devuelve nodos del SDK.
 * `measure(specs)` -> Promise<[{ width, lines, normalLineHeight }]> para specs { text, fontSize, weight, font, maxWidth? }.
 */
export async function layoutFrame(host, { width, height, fps, measure, warn = () => {} }) {
  if (!caches.has(measure)) caches.set(measure, new Map());
  const texts = new TextCache(measure, caches.get(measure));
  const root = { kind: "element", tag: "#root", style: { width, height }, ts: { ...ROOT_TEXT }, children: [] };
  root.children = host.flatMap((n) => box(n, root, warn));
  for (let round = 0; round < 6; round++) {
    const node = yogaTree(root, texts, warn);
    node.calculateLayout(width, height, Direction.LTR);
    const out = root.children.flatMap((b) => emit(b, null, texts, { fps, warn }));
    node.freeRecursive();
    if (!(await texts.flush())) return out;
  }
  throw new Error("text layout did not settle after 6 measuring rounds");
}

class TextCache {
  constructor(measure, cache) {
    Object.assign(this, { measure, cache, pending: new Map() });
  }
  static key = (s) => JSON.stringify([s.text, s.fontSize, s.weight, s.font, s.maxWidth ?? null]);
  get(spec) {
    const k = TextCache.key(spec);
    if (this.cache.has(k)) return this.cache.get(k);
    this.pending.set(k, spec);
    return { width: spec.text.length * spec.fontSize * 0.55, lines: 1, normalLineHeight: spec.fontSize * 1.2 };
  }
  async flush() {
    if (!this.pending.size) return false;
    const specs = [...this.pending.values()];
    this.pending.clear();
    const res = await this.measure(specs);
    specs.forEach((s, i) => this.cache.set(TextCache.key(s), res[i]));
    return true;
  }
}

// ---------- 1. Árbol de cajas: estilos normalizados, herencia de texto y textos en línea juntados ----------

function normalize(style = {}, tag) {
  const out = { ...UA[tag] };
  for (const [k, v] of Object.entries(style)) {
    if (v == null) continue;
    if (k === "font") Object.assign(out, css.font(v));
    else if (k === "inset") Object.assign(out, { top: v, right: v, bottom: v, left: v });
    else out[k] = v;
  }
  return out;
}

function inherit(parentTs, style, warn) {
  const ts = { ...parentTs };
  for (const k of INHERITED) {
    if (style[k] == null) continue;
    if (k === "fontSize") {
      const v = css.length(style.fontSize, { fontSize: parentTs.fontSize });
      ts.fontSize = typeof v === "object" ? (parentTs.fontSize * v.percent) / 100 : v;
    } else if (k === "fontWeight") ts.fontWeight = css.fontWeight(style.fontWeight);
    else ts[k] = style[k];
  }
  if (style.fontStyle === "italic") warn("fontStyle italic is not supported yet: text is drawn upright");
  return ts;
}

const isInlineText = (n) => n.type === "#text" || (INLINE.has(n.type) && n.children.every(isInlineText));

function collectText(n, out = []) {
  if (n.type === "#text") out.push(n.text);
  else if (n.type === "br") out.push("\n");
  else n.children.forEach((c) => collectText(c, out));
  return out;
}

function textOf(nodes, ts) {
  let s = nodes.flatMap((n) => collectText(n)).join("");
  if (ts.whiteSpace !== "pre" && ts.whiteSpace !== "pre-wrap") s = s.split("\n").map((l) => l.replace(/\s+/g, " ")).join("\n").trim();
  if (ts.textTransform === "uppercase") s = s.toUpperCase();
  else if (ts.textTransform === "lowercase") s = s.toLowerCase();
  else if (ts.textTransform === "capitalize") s = s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

function box(n, parent, warn) {
  if (n.type === "#text") {
    const text = textOf([n], parent.ts);
    return text ? [{ kind: "text", text, ts: parent.ts, style: {}, children: [] }] : [];
  }
  let style;
  try {
    style = normalize(n.props.style, n.type);
  } catch (e) {
    warn(e.message);
    style = {};
  }
  if (style.display === "none") return [];
  if (n.type === "audio") return [{ kind: "audio", host: n, style, children: [] }];
  for (const k of Object.keys(style)) if (!LAYOUT_PROPS.has(k) && !PAINT_PROPS.has(k)) warn(`style.${k} is not supported yet`);
  const b = { kind: "element", tag: n.type, host: n, style, ts: inherit(parent.ts, style, warn), children: [] };
  if (n.type === "img" || n.type === "video") return [b];
  const flex = style.display === "flex" || style.display === "inline-flex";
  if (!flex && n.children.length && n.children.every(isInlineText)) {
    if (n.children.some((c) => c.type !== "#text" && c.props?.style && Object.keys(c.props.style).length)) {
      warn("styles on inline elements inside a text run are not applied separately");
    }
    b.text = textOf(n.children, b.ts);
    return [b];
  }
  b.children = n.children.flatMap((c) => box(c, b, warn));
  return [b];
}

// ---------- 2. Yoga ----------

const config = Yoga.Config.create();
config.setPointScaleFactor(0); // sin redondeo a píxel entero, como el layout fraccionario de Chrome

const yLen = (v, ts) => {
  const l = css.length(v, { fontSize: ts.fontSize });
  return typeof l === "object" ? `${l.percent}%` : l;
};

const FLEX_DIR = { row: FlexDirection.Row, column: FlexDirection.Column, "row-reverse": FlexDirection.RowReverse, "column-reverse": FlexDirection.ColumnReverse };
const JUSTIFY = { "flex-start": Justify.FlexStart, start: Justify.FlexStart, center: Justify.Center, "flex-end": Justify.FlexEnd, end: Justify.FlexEnd, "space-between": Justify.SpaceBetween, "space-around": Justify.SpaceAround, "space-evenly": Justify.SpaceEvenly };
const ALIGN = { auto: Align.Auto, "flex-start": Align.FlexStart, start: Align.FlexStart, center: Align.Center, "flex-end": Align.FlexEnd, end: Align.FlexEnd, stretch: Align.Stretch, baseline: Align.Baseline, "space-between": Align.SpaceBetween, "space-around": Align.SpaceAround };
const WRAP = { nowrap: Wrap.NoWrap, wrap: Wrap.Wrap, "wrap-reverse": Wrap.WrapReverse };
const EDGES = { Top: Edge.Top, Right: Edge.Right, Bottom: Edge.Bottom, Left: Edge.Left };

/** margin/padding: atajo de 1-4 valores y longhands (también Inline/Block). */
function boxSides(style, prop) {
  const sides = {};
  if (style[prop] != null) {
    const v = typeof style[prop] === "number" ? [style[prop]] : css.splitTop(String(style[prop]), " ");
    const [t, r = t, b = t, l = r] = v;
    Object.assign(sides, { Top: t, Right: r, Bottom: b, Left: l });
  }
  if (style[`${prop}Inline`] != null) sides.Left = sides.Right = style[`${prop}Inline`];
  if (style[`${prop}Block`] != null) sides.Top = sides.Bottom = style[`${prop}Block`];
  for (const s of Object.keys(EDGES)) if (style[prop + s] != null) sides[s] = style[prop + s];
  return sides;
}

function borderOf(style) {
  const b = css.border(style.border) ?? { width: 0, color: "#000000" };
  if (style.borderWidth != null) b.width = css.length(style.borderWidth);
  if (style.borderColor != null) b.color = style.borderColor;
  if (style.borderStyle === "none") b.width = 0;
  return b.width > 0 ? b : null;
}

function applyStyle(node, b, warn) {
  const s = b.style;
  const set = (what, fn) => {
    try {
      fn();
    } catch (e) {
      warn(`${what}: ${e.message}`);
    }
  };
  const flex = s.display === "flex" || s.display === "inline-flex";
  // Un bloque se comporta como una columna flex cuyos hijos no encogen; las propiedades flex solo valen con display: flex.
  node.setFlexDirection(flex ? FLEX_DIR[s.flexDirection ?? "row"] : FlexDirection.Column);
  node.setFlexShrink(b.parentFlex ? 1 : 0);
  node.setAlignItems(flex ? ALIGN[s.alignItems ?? "stretch"] : Align.Stretch);
  if (flex && s.justifyContent) node.setJustifyContent(JUSTIFY[s.justifyContent]);
  if (s.alignSelf) node.setAlignSelf(ALIGN[s.alignSelf]);
  if (s.alignContent) node.setAlignContent(ALIGN[s.alignContent]);
  if (s.flexWrap) node.setFlexWrap(WRAP[s.flexWrap]);
  if (s.position === "absolute" || s.position === "fixed") node.setPositionType(PositionType.Absolute);
  for (const side of ["top", "right", "bottom", "left"]) {
    if (s[side] != null) set(side, () => node.setPosition(EDGES[side[0].toUpperCase() + side.slice(1)], yLen(s[side], b.ts)));
  }
  for (const [prop, fn] of [["width", "setWidth"], ["height", "setHeight"], ["minWidth", "setMinWidth"], ["minHeight", "setMinHeight"], ["maxWidth", "setMaxWidth"], ["maxHeight", "setMaxHeight"]]) {
    if (s[prop] != null && !(s[prop] === "auto" && prop.startsWith("m"))) set(prop, () => node[fn](yLen(s[prop], b.ts)));
  }
  for (const [side, v] of Object.entries(boxSides(s, "margin"))) {
    set("margin", () => (v === "auto" ? node.setMarginAuto(EDGES[side]) : node.setMargin(EDGES[side], yLen(v, b.ts))));
  }
  for (const [side, v] of Object.entries(boxSides(s, "padding"))) set("padding", () => node.setPadding(EDGES[side], yLen(v, b.ts)));
  set("border", () => {
    const br = borderOf(s);
    if (br) node.setBorder(Edge.All, br.width);
  });
  if (s.flex != null) {
    set("flex", () => {
      const parts = typeof s.flex === "number" ? [s.flex] : String(s.flex).trim().split(/\s+/);
      if (parts[0] === "none") return (node.setFlexGrow(0), node.setFlexShrink(0));
      if (parts[0] === "auto") return (node.setFlexGrow(1), node.setFlexShrink(1), node.setFlexBasis("auto"));
      node.setFlexGrow(Number(parts[0]));
      node.setFlexShrink(parts[1] != null ? Number(parts[1]) : 1);
      node.setFlexBasis(parts[2] != null ? yLen(parts[2], b.ts) : 0);
    });
  }
  if (s.flexGrow != null) node.setFlexGrow(Number(s.flexGrow));
  if (s.flexShrink != null) node.setFlexShrink(Number(s.flexShrink));
  if (s.flexBasis != null) set("flexBasis", () => node.setFlexBasis(yLen(s.flexBasis, b.ts)));
  if (s.gap != null) set("gap", () => node.setGap(Gutter.All, css.length(s.gap)));
  if (s.rowGap != null) set("rowGap", () => node.setGap(Gutter.Row, css.length(s.rowGap)));
  if (s.columnGap != null) set("columnGap", () => node.setGap(Gutter.Column, css.length(s.columnGap)));
  if (s.aspectRatio != null) {
    const [w, h = 1] = String(s.aspectRatio).split("/").map(Number);
    node.setAspectRatio(w / h);
  }
}

function lineHeightPx(ts, normal) {
  const v = ts.lineHeight;
  if (v === "normal" || v == null) return normal;
  if (typeof v === "number") return v * ts.fontSize;
  const l = css.length(v, { fontSize: ts.fontSize });
  return typeof l === "object" ? (l.percent / 100) * ts.fontSize : l;
}

const round2 = (v) => Math.round(v * 100) / 100;
const textSpec = (b) => ({ text: b.text, fontSize: b.ts.fontSize, weight: b.ts.fontWeight, font: b.ts.fontFamily });
const nowrap = (ts) => ts.whiteSpace === "nowrap" || ts.whiteSpace === "pre";

/** Medida de un texto dado el ancho disponible (o sin límite). */
function measureText(b, texts, maxWidth) {
  const base = textSpec(b);
  const natural = texts.get(base);
  const lh = lineHeightPx(b.ts, natural.normalLineHeight);
  const wraps = maxWidth != null && !nowrap(b.ts) && natural.width > maxWidth + 0.01;
  const res = wraps ? texts.get({ ...base, maxWidth: round2(maxWidth) }) : natural;
  return { width: res.width, lines: res.lines, lh, wraps };
}

function yogaTree(b, texts, warn) {
  const node = Yoga.Node.create(config);
  b.node = node;
  if (b.tag === "#root") {
    node.setWidth(b.style.width);
    node.setHeight(b.style.height);
  } else if (b.kind === "audio") {
    node.setPositionType(PositionType.Absolute);
    node.setDisplay(Display.None);
    return node;
  } else if (b.kind === "text") {
    node.setFlexShrink(b.parentFlex ? 1 : 0);
  } else applyStyle(node, b, warn);

  if (b.kind === "text" || b.text != null) {
    node.setMeasureFunc((w, wMode) => {
      const m = measureText(b, texts, wMode === MeasureMode.Undefined ? null : w);
      const width = wMode === MeasureMode.Exactly ? w : wMode === MeasureMode.AtMost ? Math.min(w, m.width) : m.width;
      return { width, height: m.lines * m.lh };
    });
    return node;
  }
  const flex = b.style.display === "flex" || b.style.display === "inline-flex";
  b.children.forEach((c, i) => {
    c.parentFlex = flex;
    node.insertChild(yogaTree(c, texts, warn), i);
  });
  return node;
}

// ---------- 3. Nodos del SDK ----------

const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function origin(v, w, h) {
  const words = { left: "0%", top: "0%", center: "50%", right: "100%", bottom: "100%" };
  const parts = (v == null ? "50% 50%" : String(v)).trim().split(/\s+/).map((p) => words[p] ?? p);
  if (parts.length === 1) parts.push("50%");
  if (["top", "bottom"].includes(String(v).split(/\s+/)[0])) parts.reverse();
  const at = (p, size) => (p.endsWith("%") ? (parseFloat(p) / 100) * size : parseFloat(p));
  return [at(parts[0], w), at(parts[1], h)];
}

function radiusOf(style, w, h, warn) {
  if (style.borderRadius == null) return 0;
  try {
    const first = typeof style.borderRadius === "number" ? style.borderRadius : css.splitTop(String(style.borderRadius), " ")[0];
    const r = css.length(first);
    return typeof r === "object" ? (Math.min(w, h) * r.percent) / 100 : r;
  } catch (e) {
    warn(`borderRadius: ${e.message}`);
    return 0;
  }
}

function emit(b, clip, texts, opts) {
  const { warn } = opts;
  const n = b.node;
  const [L, T, W, H] = [n.getComputedLeft(), n.getComputedTop(), n.getComputedWidth(), n.getComputedHeight()];
  if (b.kind === "audio") return audioNode(b, opts);
  if (b.kind === "text") return textNode(b, 0, 0, W, H, texts, { L, T });

  const s = b.style;
  let t = { tx: 0, ty: 0, scale: 1 };
  try {
    t = css.transform(s.transform, W, H);
  } catch (e) {
    warn(e.message);
  }
  const [ox, oy] = origin(s.transformOrigin, W, H);
  const group = { type: "group", x: L + ox + t.tx - t.scale * ox, y: T + oy + t.ty - t.scale * oy, scale: t.scale, opacity: s.opacity == null ? 1 : Number(s.opacity), children: [] };

  // overflow: hidden con radio: los hijos que ocupan toda la caja (una pantalla con su vídeo) heredan las esquinas.
  const fills = clip && Math.abs(L - clip.x) < 0.5 && Math.abs(T - clip.y) < 0.5 && Math.abs(W - clip.w) < 0.5 && Math.abs(H - clip.h) < 0.5;
  if (clip && !fills && (L < clip.x - 0.5 || T < clip.y - 0.5 || L + W > clip.x + clip.w + 0.5 || T + H > clip.y + clip.h + 0.5)) {
    warn("overflow: hidden only clips children that fill the box: other children are drawn unclipped");
  }
  const radius = radiusOf(s, W, H, warn) || (fills ? clip.radius : 0);
  const bw = [Edge.Left, Edge.Top, Edge.Right, Edge.Bottom].map((e) => n.getComputedPadding(e) + n.getComputedBorder(e));
  const content = [bw[0], bw[1], W - bw[0] - bw[2], H - bw[1] - bw[3]];

  if (b.tag === "video" || b.tag === "img") {
    group.children.push(b.tag === "video" ? videoNode(b, content, radius, opts) : imageNode(b, content, radius, warn));
    return [group];
  }
  group.children.push(...paint(b, W, H, radius, warn));
  if (b.text != null) group.children.push(...textNode(b, ...content, texts));
  const ownClip = s.overflow === "hidden" && radius > 0 ? { x: bw[0] - n.getComputedPadding(Edge.Left), y: bw[1] - n.getComputedPadding(Edge.Top), w: W - (bw[0] - n.getComputedPadding(Edge.Left)) * 2, h: H - (bw[1] - n.getComputedPadding(Edge.Top)) * 2, radius } : null;
  const passClip = ownClip ?? (fills ? { x: 0, y: 0, w: W, h: H, radius: clip.radius } : null);
  for (const c of b.children) group.children.push(...emit(c, passClip, texts, opts));
  return [group];
}

function paint(b, W, H, radius, warn) {
  const s = b.style;
  const out = [];
  let bg = null;
  let shadow = null;
  let border = null;
  try {
    bg = css.background(s.background ?? s.backgroundImage ?? s.backgroundColor);
    if (bg?.color && css.color(bg.color)[3] === 0) bg = null;
  } catch (e) {
    warn(e.message);
  }
  try {
    shadow = css.boxShadow(s.boxShadow);
    if (shadow?.spread) warn("boxShadow spread is not supported yet");
  } catch (e) {
    warn(e.message);
  }
  try {
    border = borderOf(s);
  } catch (e) {
    warn(`border: ${e.message}`);
  }
  const sh = shadow && { x: shadow.x, y: shadow.y, blur: shadow.blur, color: shadow.color };
  const rect = (x, y, w, h, r, fill, withShadow) => ({ type: "rect", x, y, width: w, height: h, radius: r, ...fill, ...(withShadow && sh ? { shadow: sh } : {}) });
  if (border && bg) {
    out.push(rect(0, 0, W, H, radius, { color: border.color }, true));
    const k = border.width;
    out.push(rect(k, k, W - 2 * k, H - 2 * k, Math.max(0, radius - k), bg, false));
  } else if (border) {
    if (radius > 0) warn("a rounded border without a background is drawn with square corners");
    const k = border.width;
    const c = { color: border.color };
    out.push(rect(0, 0, W, k, 0, c), rect(0, H - k, W, k, 0, c), rect(0, k, k, H - 2 * k, 0, c), rect(W - k, k, k, H - 2 * k, 0, c));
  } else if (bg) {
    out.push(rect(0, 0, W, H, radius, bg, true));
  } else if (shadow) {
    warn("boxShadow on an element without a background is not supported");
  }
  return out;
}

function textNode(b, x, y, W, H, texts, at = { L: 0, T: 0 }) {
  if (!b.text) return [];
  const m = measureText(b, texts, nowrap(b.ts) ? null : W);
  const [r, g, bl, a] = css.color(b.ts.color);
  const align = b.ts.textAlign === "start" ? "left" : b.ts.textAlign === "end" ? "right" : b.ts.textAlign;
  const left = at.L + x;
  const cx = m.wraps ? left + W / 2 : align === "center" ? left + W / 2 : align === "right" ? left + W - m.width / 2 : left + m.width / 2;
  const node = { type: "text", text: b.text, x: cx, y: at.T + y + (m.lines * m.lh) / 2, size: b.ts.fontSize, weight: b.ts.fontWeight, color: hex([r, g, bl]), font: b.ts.fontFamily, lineHeight: m.lh, opacity: a };
  if (m.wraps) Object.assign(node, { maxWidth: round2(W), textAlign: align });
  return [node];
}

function videoNode(b, [x, y, w, h], radius, { warn }) {
  const { media, props } = b.host;
  if (!media.muted && media.volume !== 0) warn("the audio track of <Video> is not mixed yet: pass muted and add an <Audio> with the same file");
  const fit = b.style.objectFit ?? "contain";
  if (!["cover", "fill", "contain"].includes(fit)) warn(`objectFit ${fit} is not supported`);
  if (!w || !h) warn("<Video> needs a width and height (for example style={{ width: '100%', height: '100%' }})");
  return { type: "video", src: props.src, x, y, width: w, height: h, radius, fit, from: media.start, durationInFrames: media.end - media.start, startFrom: media.startFromSec, playbackRate: media.rate };
}

function imageNode(b, [x, y, w, h], radius, warn) {
  if (b.style.objectFit && b.style.objectFit !== "fill") warn(`objectFit ${b.style.objectFit} on <Img> is not supported yet: the image is stretched`);
  if (!w || !h) warn("<Img> needs a width and height");
  return { type: "image", src: b.host.props.src, x, y, width: w, height: h, radius };
}

function audioNode(b, { fps, warn }) {
  const { media, props } = b.host;
  if (media.muted) return [];
  if (media.volume !== 1) warn("<Audio volume> is not supported yet: audio plays at full volume");
  if (media.rate !== 1) warn("<Audio playbackRate> is not supported yet");
  return [{ type: "audio", src: props.src, from: media.start, startFrom: media.startFromSec, durationInSeconds: (media.end - media.start) / fps }];
}
