// Tests del SDK de composición: nodos (rect, text, image, video, group, sequence) -> formato del motor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composition, rect, text, image, video, audio, group, sequence, compile } from "./compose.mjs";

const probe = async () => ({ w: 1000, h: 2000 });
const comp = (render, opts = {}) => composition({ width: 200, height: 100, fps: 30, durationInFrames: 10, background: "#101010", ...opts }, render);
const draws = async (render, f = 0, opts) => (await compile(comp(render, opts), { probe })).frames[f].draws;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("un fotograma por fotograma de la composición y la escena con su fondo", async () => {
  const out = await compile(comp(() => null), { probe });
  assert.equal(out.frames.length, 10);
  assert.deepEqual([out.scene.width, out.scene.height, out.scene.fps, out.scene.background], [200, 100, 30, "#101010"]);
  assert.deepEqual(out.streams, []);
});

test("rect: color CSS, radio, sombra debajo y degradado con ángulo CSS", async () => {
  const [shadow, box] = await draws(() =>
    rect({ x: 10, y: 20, width: 50, height: 30, radius: 8, color: "#ff0000", shadow: { y: 10, blur: 20, color: "rgba(0,0,0,0.5)" } }),
  );
  assert.deepEqual(box.rect, [10, 20, 50, 30]);
  assert.deepEqual(box.color, [1, 0, 0, 1]);
  assert.equal(box.radius, 8);
  assert.deepEqual(shadow.rect, [10, 30, 50, 30]);
  assert.equal(shadow.softness, 20);
  assert.deepEqual(shadow.color, [0, 0, 0, 0.5]);
  const [g] = await draws(() => rect({ x: 0, y: 0, width: 10, height: 10, gradient: { from: "#000", to: "#fff", angle: 90 } }));
  close(g.gradient.dir[0], 1);
  close(g.gradient.dir[1], 0);
  assert.deepEqual(g.gradient.to, [1, 1, 1, 1]);
});

test("group desplaza, escala y multiplica la opacidad de sus hijos", async () => {
  const [r] = await draws(() =>
    group({ x: 100, y: 10, scale: 2, opacity: 0.5 }, [group({ opacity: 0.5 }, rect({ x: 1, y: 2, width: 3, height: 4, radius: 1, opacity: 0.8 }))]),
  );
  assert.deepEqual(r.rect, [102, 14, 6, 8]);
  assert.equal(r.radius, 2);
  close(r.opacity, 0.2);
});

test("sequence solo pinta en su intervalo y pasa el fotograma local", async () => {
  const render = () => sequence({ from: 3, durationInFrames: 4 }, (f) => text({ text: `f${f}`, x: 0, y: 0 }));
  const out = await compile(comp(render), { probe });
  const textOf = (f) => out.frames[f].draws.map((d) => out.scene.texts.find((t) => t.id === d.id)?.text);
  assert.deepEqual(textOf(2), []);
  assert.deepEqual(textOf(3), ["f0"]);
  assert.deepEqual(textOf(6), ["f3"]);
  assert.deepEqual(textOf(7), []);
});

test("text: textos deduplicados, escala, fondo y anclaje abajo", async () => {
  const out = await compile(
    comp(() => [
      text({ text: "Hola", x: 50, y: 90, size: 40, weight: 700, color: "#fff", scale: 1.5, anchor: "bottom", maxWidth: 120, background: { color: "#000", padX: 10, padY: 5, radius: 6 } }),
      text({ text: "Hola", x: 50, y: 90, size: 40, weight: 700, color: "#fff" }),
    ]),
    { probe },
  );
  assert.equal(out.scene.texts.length, 2, "mismo texto con distinto maxWidth son dos rasterizados");
  const [t] = out.frames[0].draws;
  assert.equal(t.scale, 1.5);
  assert.equal(t.anchorBottom, true);
  assert.deepEqual(t.bg, { color: [0, 0, 0, 1], padX: 10, padY: 5, radius: 6 });
  const spec = out.scene.texts.find((x) => x.id === t.id);
  assert.deepEqual([spec.text, spec.fontSize, spec.weight, spec.color, spec.maxWidth], ["Hola", 40, 700, "#ffffff", 120]);
});

test("image se registra una vez y se dibuja en su rectángulo", async () => {
  const out = await compile(comp(() => image({ src: "docs/logo.png", x: 5, y: 6, width: 7, height: 8, radius: 2 })), { probe });
  assert.deepEqual(out.images, [{ id: "img0", file: "docs/logo.png" }]);
  assert.deepEqual(out.frames[3].draws[0], { kind: "image", id: "img0", quad: [5, 6, 7, 8], radius: 2, opacity: 1 });
});

test("video: flujo con inicio absoluto (dentro de una sequence), velocidad y recorte cover", async () => {
  const render = () =>
    sequence({ from: 2 }, () => video({ src: "media/phone.mp4", x: 0, y: 0, width: 100, height: 100, from: 1, startFrom: 5, playbackRate: 2 }));
  const out = await compile(comp(render), { probe });
  assert.equal(out.streams.length, 1);
  const s = out.streams[0];
  assert.deepEqual([s.file, s.from, s.frames, s.srcStartSec, s.rate], ["media/phone.mp4", 3, 7, 5, 2]);
  // Fuente 1000x2000 en un hueco cuadrado: cover recorta arriba y abajo -> se ve la mitad central en vertical.
  const v = out.frames[5].draws.find((d) => d.kind === "video");
  assert.equal(v.source, s.id);
  assert.deepEqual(v.uv, [0, 0.25, 1, 0.75]);
  // Decodifica a la resolución que se ve: 100 px de ancho visibles = toda la fuente a 100 px de ancho.
  assert.deepEqual([s.w, s.h], [100, 200]);
  assert.equal(out.frames[2].draws.length, 0, "antes de su inicio no se dibuja");
});

test("video con fit fill no recorta", async () => {
  const [v] = await draws(() => video({ src: "a.mp4", x: 0, y: 0, width: 100, height: 100, fit: "fill" }));
  assert.deepEqual(v.uv, [0, 0, 1, 1]);
});

test("text con fuente y alineación a la izquierda", async () => {
  const out = await compile(comp(() => text({ text: "npm run render", x: 10, y: 20, font: "Consolas", align: "left" })), { probe });
  assert.equal(out.scene.texts[0].font, "Consolas");
  assert.equal(out.frames[0].draws[0].align, "left");
});

test("audio: clips en segundos absolutos (dentro de sequence) del mismo archivo", async () => {
  const render = () => [
    audio({ src: "media/voz.mp3" }),
    sequence({ from: 6 }, () => audio({ src: "media/voz.mp3", startFrom: 2, durationInSeconds: 0.5 })),
  ];
  const out = await compile(comp(render), { probe });
  assert.deepEqual(out.audio, {
    file: "media/voz.mp3",
    clips: [
      { fromSec: 0, srcStartSec: 0, durationSec: 10 / 30 },
      { fromSec: 6 / 30, srcStartSec: 2, durationSec: 0.5 },
    ],
  });
  assert.equal(out.frames[7].draws.length, 0, "el audio no dibuja nada");
});

test("audio de dos archivos distintos todavía no está soportado", async () => {
  await assert.rejects(compile(comp(() => [audio({ src: "a.mp3" }), audio({ src: "b.mp3" })]), { probe }), /un solo archivo/);
});

test("ignora hijos falsy como React ('', 0, false, null, undefined)", async () => {
  const d = await draws(() => ["", 0, false, null, undefined, rect({ x: 0, y: 0, width: 1, height: 1 })]);
  assert.equal(d.length, 1);
});

test("text con altura de línea y alineación de líneas partidas pasa al motor", async () => {
  const out = await compile(comp(() => text({ text: "a b c", x: 10, y: 10, size: 20, lineHeight: 30, textAlign: "left", maxWidth: 40 })), { probe });
  assert.deepEqual(out.scene.texts[0], { id: "t0", text: "a b c", fontSize: 20, color: "#ffffff", weight: 600, maxWidth: 40, lineHeight: 30, textAlign: "left" });
});

test("video con fit contain: encaja la fuente sin recortar, centrada en su caja", async () => {
  // Fuente 1000x2000 (vertical) en una caja de 200x100: queda de 50x100 centrada.
  const [d] = await draws(() => video({ src: "v.mp4", x: 0, y: 0, width: 200, height: 100, fit: "contain" }));
  assert.deepEqual(d.rect, [75, 0, 50, 100]);
  assert.deepEqual(d.uv, [0, 0, 1, 1]);
});

test("render puede ser asíncrono (la capa React calcula el layout así)", async () => {
  const [r] = await draws(async ({ frame }) => rect({ x: frame, y: 0, width: 1, height: 1 }), 3);
  assert.deepEqual(r.rect, [3, 0, 1, 1]);
});
