// Tests del layout: nodos anfitrión (div, img, video, audio, texto) con estilos CSS -> flexbox (Yoga) -> nodos del SDK.
// Los textos se miden con un medidor falso (ancho = 0,5 x tamaño por carácter, línea normal = 1,25 x tamaño).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "./react.mjs";
import { AbsoluteFill, Sequence, Video, Audio, Img } from "./remotion.mjs";
import { renderFrame } from "./runtime.mjs";
import { layoutFrame } from "./layout.mjs";

const CONFIG = { id: "T", width: 1920, height: 1080, fps: 30, durationInFrames: 300 };

export async function fakeMeasure(specs) {
  return specs.map((s) => {
    const natural = s.text.length * s.fontSize * 0.5;
    const wraps = s.maxWidth != null && natural > s.maxWidth;
    return { width: wraps ? s.maxWidth : natural, lines: wraps ? Math.ceil(natural / s.maxWidth) : 1, normalLineHeight: s.fontSize * 1.25 };
  });
}

async function draw(el, { frame = 0, warnings = [] } = {}) {
  const host = renderFrame(el, { ...CONFIG, frame });
  return resolve(await layoutFrame(host, { ...CONFIG, measure: fakeMeasure, warn: (m) => warnings.push(m) }));
}

/** Aplana los grupos del SDK a coordenadas absolutas para comparar. */
function resolve(nodes, ctx = { x: 0, y: 0, s: 1, o: 1 }, out = []) {
  for (const n of nodes) {
    if (n.type === "group") {
      resolve(n.children, { x: ctx.x + (n.x ?? 0) * ctx.s, y: ctx.y + (n.y ?? 0) * ctx.s, s: ctx.s * (n.scale ?? 1), o: ctx.o * (n.opacity ?? 1) }, out);
      continue;
    }
    const r = { ...n, opacity: ctx.o * (n.opacity ?? 1) };
    if ("x" in n) r.x = ctx.x + n.x * ctx.s;
    if ("y" in n) r.y = ctx.y + n.y * ctx.s;
    for (const k of ["width", "height", "radius", "size"]) if (k in n) r[k] = n[k] * ctx.s;
    out.push(r);
  }
  return out;
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg ?? ""}: ${a} != ${b}`);

test("AbsoluteFill con fondo: un rectángulo que ocupa el lienzo", async () => {
  const [r] = await draw(h(AbsoluteFill, { style: { background: "#F4F1EC" } }));
  assert.deepEqual([r.type, r.x, r.y, r.width, r.height, r.color], ["rect", 0, 0, 1920, 1080, "#F4F1EC"]);
});

test("div absoluto con padding, radio y sombra; el hijo al 100% ocupa la caja de contenido", async () => {
  const el = h(AbsoluteFill, null,
    h("div", { style: { position: "absolute", left: 100, top: 50, padding: 16, background: "#121214", borderRadius: 60, boxShadow: "0 40px 80px rgba(31,31,31,0.28)" } },
      h("div", { style: { width: 400, height: 300, borderRadius: 44, overflow: "hidden", background: "red" } })));
  const [outer, inner] = await draw(el);
  assert.deepEqual([outer.x, outer.y, outer.width, outer.height, outer.radius], [100, 50, 432, 332, 60]);
  assert.deepEqual(outer.shadow, { x: 0, y: 40, blur: 80, color: "rgba(31,31,31,0.28)" });
  assert.deepEqual([inner.x, inner.y, inner.width, inner.height, inner.radius], [116, 66, 400, 300, 44]);
});

test("flexbox: fila centrada con gap", async () => {
  const box = (c) => h("div", { style: { width: 100, height: 100, background: c } });
  const el = h("div", { style: { position: "absolute", left: 0, top: 0, width: 1000, height: 400, display: "flex", justifyContent: "center", alignItems: "center", gap: 30 } }, box("red"), box("green"), box("blue"));
  const rects = await draw(el);
  assert.deepEqual(rects.map((r) => [r.x, r.y]), [[320, 150], [450, 150], [580, 150]]);
});

test("texto centrado con translateY(-50%): la línea queda centrada en top", async () => {
  const el = h(AbsoluteFill, null,
    h("div", { style: { position: "absolute", left: 0, right: 0, top: 105, transform: "translateY(-50%)", textAlign: "center", font: '600 64px "Segoe UI", sans-serif', color: "#1F1F1F" } }, "Rendered on the GPU"));
  const [t] = await draw(el);
  assert.equal(t.type, "text");
  assert.equal(t.text, "Rendered on the GPU");
  near(t.x, 960, "x");
  near(t.y, 105, "y");
  assert.deepEqual([t.size, t.weight, t.color, t.font, t.lineHeight], [64, 600, "#1f1f1f", '"Segoe UI", sans-serif', 80]);
  assert.equal(t.maxWidth, undefined);
});

test("texto alineado a la izquierda o a la derecha dentro de su caja", async () => {
  const line = (textAlign) => h("div", { style: { position: "absolute", left: 100, top: 0, width: 1000, fontSize: 20, lineHeight: "30px", textAlign } }, "abcd");
  const [l] = await draw(line("left"));
  const [r] = await draw(line("right"));
  near(l.x, 100 + 20, "izquierda"); // 4 caracteres x 10 px = 40 de ancho
  near(r.x, 1100 - 20, "derecha");
  near(l.y, 15, "centro de la línea");
  assert.equal(l.lineHeight, 30);
});

test("texto que no cabe: se parte al ancho de la caja y crece en alto", async () => {
  const el = h("div", { style: { position: "absolute", left: 0, top: 0, width: 200, fontSize: 20, lineHeight: 1.5, textAlign: "left" } }, "x".repeat(50));
  const [t] = await draw(el);
  assert.equal(t.maxWidth, 200);
  assert.equal(t.textAlign, "left");
  near(t.x, 100, "centro de la caja partida");
  near(t.y, (3 * 30) / 2, "tres líneas de 30");
});

test("herencia: color, tamaño y familia vienen del ancestro; por defecto Times New Roman negro de 16 px", async () => {
  const [a] = await draw(h("div", { style: { color: "rgba(255,0,0,0.5)", fontFamily: "Inter", fontSize: 30 } }, h("div", null, "hola")));
  assert.deepEqual([a.color, a.font, a.size, a.opacity], ["#ff0000", "Inter", 30, 0.5]);
  const [b] = await draw(h("div", { style: { textTransform: "uppercase" } }, "hola"));
  assert.deepEqual([b.text, b.color, b.font, b.size, b.weight], ["HOLA", "#000000", '"Times New Roman", serif', 16, 400]);
});

test("los hijos en línea (span, strong) se juntan en un solo texto", async () => {
  const [t, ...rest] = await draw(h("div", null, "Hola ", h("strong", null, "mundo"), "!"));
  assert.equal(t.text, "Hola mundo!");
  assert.equal(rest.length, 0);
});

test("opacidad y escala alrededor del centro de la caja", async () => {
  const el = h("div", { style: { position: "absolute", left: 0, top: 0, width: 100, height: 100, opacity: 0.5, transform: "scale(2)", background: "#fff" } });
  const [r] = await draw(el);
  assert.deepEqual([r.x, r.y, r.width, r.height, r.opacity], [-50, -50, 200, 200, 0.5]);
});

test("display: none no pinta nada", async () => {
  assert.deepEqual(await draw(h("div", { style: { display: "none", background: "red", width: 10, height: 10 } })), []);
});

test("vídeo recortado por un padre con overflow hidden y radio, con su tramo y fit", async () => {
  const el = h(Sequence, { from: 30, durationInFrames: 60 },
    h("div", { style: { position: "absolute", left: 10, top: 20, width: 400, height: 300, borderRadius: 44, overflow: "hidden" } },
      h(Video, { src: "phone.mp4", trimBefore: 15, muted: true, style: { width: "100%", height: "100%", objectFit: "cover" } })));
  const [v] = await draw(el, { frame: 40 });
  assert.deepEqual(
    [v.type, v.src, v.x, v.y, v.width, v.height, v.radius, v.fit, v.from, v.durationInFrames, v.startFrom, v.playbackRate],
    ["video", "phone.mp4", 10, 20, 400, 300, 44, "cover", 30, 60, 0.5, 1],
  );
});

test("vídeo sin objectFit usa contain (el valor por defecto de <video>) y avisa si tiene sonido", async () => {
  const warnings = [];
  const [v] = await draw(h(Video, { src: "a.mp4", style: { width: 640, height: 360 } }), { warnings });
  assert.equal(v.fit, "contain");
  assert.ok(warnings.some((w) => /audio/.test(w)), warnings.join("\n"));
});

test("audio e imagen", async () => {
  const el = h(Sequence, { from: 15 }, h(Audio, { src: "voz.mp3", trimBefore: 30 }), h(Img, { src: "logo.png", style: { position: "absolute", left: 5, top: 6, width: 70, height: 80, borderRadius: 8 } }));
  const [a, img] = await draw(el, { frame: 20 });
  assert.deepEqual([a.type, a.src, a.from, a.startFrom, a.durationInSeconds], ["audio", "voz.mp3", 15, 1, 285 / 30]);
  assert.deepEqual([img.type, img.src, img.x, img.y, img.width, img.height, img.radius], ["image", "logo.png", 5, 6, 70, 80, 8]);
});

test("lo que el motor no sabe pintar avisa y sigue sin ese efecto", async () => {
  const warnings = [];
  const [r] = await draw(h("div", { style: { width: 10, height: 10, background: "red", transform: "rotate(45deg)" } }), { warnings });
  assert.equal(r.type, "rect");
  assert.match(warnings[0], /rotate/);
});

test("border: un rect con trazo (con o sin fondo) y radio recortado a la mitad de la caja", async () => {
  const [line] = await draw(h("div", { style: { position: "absolute", left: 0, top: 0, width: 100, height: 50, border: "2px solid #fff" } }));
  assert.deepEqual([line.x, line.y, line.width, line.height, line.color, line.border], [0, 0, 100, 50, undefined, { width: 2, color: "#fff" }]);
  const [card] = await draw(h("div", { style: { position: "absolute", left: 0, top: 0, width: 100, height: 50, borderRadius: 999, border: "2px solid #fff", background: "#000" } }));
  assert.deepEqual([card.color, card.radius, card.border], ["#000", 25, { width: 2, color: "#fff" }]);
});

test("h1 lleva los márgenes del navegador, pero margin: 0 del autor los anula", async () => {
  const col = (h1Style) => h("div", { style: { position: "absolute", left: 0, top: 0, width: 500 } }, h("h1", { style: { fontSize: 40, lineHeight: "50px", ...h1Style } }, "T"), h("div", { style: { height: 10, background: "red" } }));
  const [t1, r1] = await draw(col({}));
  near(t1.y, 40 * 0.67 + 25, "h1 con margen por defecto");
  near(r1.y, 40 * 0.67 * 2 + 50, "el bloque siguiente baja");
  const [t2, r2] = await draw(col({ margin: 0 }));
  near(t2.y, 25, "sin margen");
  near(r2.y, 50, "pegado al h1");
});
