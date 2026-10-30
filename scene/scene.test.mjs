// Tests del modelo de escena compartido por las tres variantes (navegador, Rust, Remotion).
// Ejecutar: node --test scene/
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENE, frameAt, dumpLayout, drawList } from "./scene.mjs";

const N = SCENE.fps * SCENE.durationSec;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("1920x1080, 30 fps, 60 s => 1800 fotogramas", () => {
  assert.equal(SCENE.width, 1920);
  assert.equal(SCENE.height, 1080);
  assert.equal(N, 1800);
  assert.equal(dumpLayout().frames.length, 1800);
});

test("los dos dispositivos conservan la proporción de su fuente en todos los fotogramas", () => {
  for (let f = 0; f < N; f++) {
    for (const dev of frameAt(f).devices) {
      const src = SCENE.sources[dev.source];
      assert.ok(close(dev.screen.w / dev.screen.h, src.w / src.h, 1e-9), `f=${f} ${dev.source}`);
    }
  }
});

test("los dispositivos (con marco) nunca se salen del lienzo", () => {
  for (let f = 0; f < N; f++) {
    for (const d of frameAt(f).devices) {
      const b = d.bezel;
      assert.ok(d.screen.x - b >= 0 && d.screen.y - b >= 0, `f=${f} ${d.source} sale por arriba/izquierda`);
      assert.ok(d.screen.x + d.screen.w + b <= SCENE.width, `f=${f} ${d.source} sale por la derecha`);
      assert.ok(d.screen.y + d.screen.h + b <= SCENE.height, `f=${f} ${d.source} sale por abajo`);
    }
  }
});

test("la transición va de 0 a 1 entre los fotogramas 900 y 930, sin retroceder", () => {
  assert.equal(frameAt(899).transition, 0);
  assert.equal(frameAt(900).transition, 0);
  assert.equal(frameAt(930).transition, 1);
  assert.equal(frameAt(1799).transition, 1);
  let prev = 0;
  for (let f = 900; f <= 930; f++) {
    const p = frameAt(f).transition;
    assert.ok(p >= prev, `f=${f}`);
    prev = p;
  }
});

test("antes de la transición el móvil está a la izquierda del iPad y después a la derecha", () => {
  const pos = (f) => Object.fromEntries(frameAt(f).devices.map((d) => [d.source, d.screen.x]));
  assert.ok(pos(0).phone < pos(0).tablet);
  assert.ok(pos(1799).phone > pos(1799).tablet);
});

test("el iPad crece en la transición", () => {
  const w = (f) => frameAt(f).devices.find((d) => d.source === "tablet").screen.w;
  assert.ok(w(1799) > w(0) * 1.2);
});

test("el título 1 entra en 1 s desde abajo y el título 2 (árabe) sustituye al 1 tras la transición", () => {
  const t = (f, id) => frameAt(f).texts.find((x) => x.id === id);
  assert.equal(t(0, "title1").opacity, 0);
  assert.ok(t(0, "title1").dy > 0);
  assert.equal(t(30, "title1").opacity, 1);
  assert.equal(t(30, "title1").dy, 0);
  assert.equal(t(600, "title2").opacity, 0);
  assert.equal(t(1799, "title1").opacity, 0);
  assert.equal(t(1799, "title2").opacity, 1);
  for (let f = 0; f < N; f++) {
    for (const x of frameAt(f).texts) assert.ok(x.opacity >= 0 && x.opacity <= 1, `f=${f} ${x.id}`);
  }
});

test("los textos incluyen escritura RTL y CJK para probar el motor de texto", () => {
  const all = SCENE.texts.map((t) => t.text).join(" ");
  assert.match(all, /[؀-ۿ]/, "falta árabe");
  assert.match(all, /[一-鿿]/, "falta chino");
});

test("el tiempo de cada fuente avanza 1/30 s por fotograma desde su desfase", () => {
  for (const f of [0, 1, 899, 1799]) {
    for (const d of frameAt(f).devices) {
      assert.ok(close(d.sourceTime, SCENE.sources[d.source].offsetSec + f / SCENE.fps));
    }
  }
});

test("los fotogramas fuera de rango lanzan error", () => {
  assert.throws(() => frameAt(-1));
  assert.throws(() => frameAt(1800));
});

test("la lista de dibujo pinta sombra, marco y pantalla de cada dispositivo y luego los textos visibles", () => {
  const kinds = (f) => drawList(frameAt(f)).map((d) => `${d.kind}:${d.source ?? d.id ?? ""}`);
  assert.deepEqual(kinds(15), [
    "shape:tablet", "shape:tablet", "video:tablet",
    "shape:phone", "shape:phone", "video:phone",
    "text:title1",
  ]);
  assert.ok(!kinds(0).some((k) => k.startsWith("text")), "texto invisible en f=0 no se dibuja");
  assert.ok(kinds(1799).includes("text:title2"));
});

test("el marco rodea la pantalla con su grosor y el quad de la sombra cubre el difuminado", () => {
  const [shadow, bezel, screen] = drawList(frameAt(0));
  assert.equal(bezel.rect[0], screen.rect[0] - 20);
  assert.equal(bezel.rect[2], screen.rect[2] + 40);
  assert.equal(bezel.radius, screen.radius + 20);
  assert.ok(shadow.quad[0] <= shadow.rect[0] - shadow.softness);
  assert.ok(shadow.quad[2] >= shadow.rect[2] + 2 * shadow.softness);
  assert.deepEqual(screen.quad, screen.rect);
});

test("dumpLayout incluye la lista de dibujo por fotograma para la variante Rust", () => {
  const d = dumpLayout();
  assert.ok(Array.isArray(d.frames[0].draws));
});

test("se puede importar donde `process` existe sin argv (bundles de navegador como el de Remotion)", async () => {
  const { execFileSync } = await import("node:child_process");
  const url = new URL("./scene.mjs", import.meta.url).href;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `process.argv = undefined; const m = await import(${JSON.stringify(url)}); console.log(typeof m.frameAt);`]);
  assert.equal(String(out).trim(), "function");
});

test("dumpLayout usa el formato del motor: un flujo por fuente a velocidad 1 y tamaño de decodificación par", () => {
  const d = dumpLayout();
  const tablet = d.streams.find((s) => s.id === "tablet");
  assert.deepEqual(tablet, { id: "tablet", file: "media/tablet.mp4", srcStartSec: 30, rate: 1, from: 0, frames: 1800, w: 1240, h: 862 });
  assert.equal(d.streams.find((s) => s.id === "phone").h, 824);
  assert.equal(d.audio, null);
  assert.ok(d.scene.texts.every((t) => t.weight === 600));
});
