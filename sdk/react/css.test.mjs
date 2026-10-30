// Tests del traductor de estilos CSS (los valores que llegan en `style={{...}}` de un componente React).
import { test } from "node:test";
import assert from "node:assert/strict";
import { length, color, background, boxShadow, transform, font, fontWeight, border } from "./css.mjs";

test("length: números y px, porcentajes, em/rem y auto", () => {
  assert.equal(length(12), 12);
  assert.equal(length("12px"), 12);
  assert.equal(length("-4.5px"), -4.5);
  assert.deepEqual(length("50%"), { percent: 50 });
  assert.equal(length("2em", { fontSize: 20 }), 40);
  assert.equal(length("1.5rem"), 24);
  assert.equal(length("auto"), "auto");
  assert.equal(length(undefined), undefined);
  assert.throws(() => length("calc(100% - 10px)"), /calc/);
});

test("color: hex, rgb(a), hsl(a) y nombres -> [r, g, b, a] (0..255, alfa 0..1)", () => {
  assert.deepEqual(color("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(color("rgba(31,31,31,0.28)"), [31, 31, 31, 0.28]);
  assert.deepEqual(color("hsl(0, 100%, 50%)"), [255, 0, 0, 1]);
  assert.deepEqual(color("hsla(120 100% 25% / 0.5)"), [0, 128, 0, 0.5]);
  assert.deepEqual(color("transparent"), [0, 0, 0, 0]);
});

test("background: color sólido o linear-gradient de dos paradas con ángulo o dirección", () => {
  assert.deepEqual(background("#112233"), { color: "#112233" });
  assert.deepEqual(background("linear-gradient(135deg, #000 0%, #fff 100%)"), { gradient: { from: "#000", to: "#fff", angle: 135 } });
  assert.deepEqual(background("linear-gradient(to right, rgba(0,0,0,0.5), red)"), { gradient: { from: "rgba(0,0,0,0.5)", to: "red", angle: 90 } });
  assert.deepEqual(background("linear-gradient(#000, #fff)").gradient.angle, 180);
  const multi = background("linear-gradient(90deg, red, green, blue)");
  assert.deepEqual([multi.gradient.from, multi.gradient.to], ["red", "blue"]);
  assert.equal(background("none"), null);
});

test("boxShadow: desplazamiento, desenfoque y color (la primera sombra si hay varias)", () => {
  assert.deepEqual(boxShadow("0 40px 80px rgba(31,31,31,0.28)"), { x: 0, y: 40, blur: 80, spread: 0, color: "rgba(31,31,31,0.28)" });
  assert.deepEqual(boxShadow("rgba(0,0,0,.5) 2px 4px 6px 1px, 0 0 2px red"), { x: 2, y: 4, blur: 6, spread: 1, color: "rgba(0,0,0,.5)" });
  assert.equal(boxShadow("none"), null);
  assert.throws(() => boxShadow("inset 0 0 4px red"), /inset/);
});

test("transform: compone translate (px y %) y scale en orden, y rechaza rotaciones", () => {
  assert.deepEqual(transform("translateY(-50%)", 200, 100), { tx: 0, ty: -50, scale: 1 });
  assert.deepEqual(transform("translate(10px, 20px) scale(2)", 0, 0), { tx: 10, ty: 20, scale: 2 });
  assert.deepEqual(transform("scale(2) translateX(10px)", 0, 0), { tx: 20, ty: 0, scale: 2 });
  assert.deepEqual(transform("scale(0.5, 0.5) translate3d(4px, 0, 0)", 0, 0), { tx: 2, ty: 0, scale: 0.5 });
  assert.deepEqual(transform("rotate(0deg)", 0, 0), { tx: 0, ty: 0, scale: 1 });
  assert.throws(() => transform("rotate(10deg)", 0, 0), /rotate/);
  assert.throws(() => transform("scale(1, 2)", 0, 0), /scale/);
  assert.deepEqual(transform(undefined, 0, 0), { tx: 0, ty: 0, scale: 1 });
});

test("font: el atajo CSS se reparte en peso, tamaño, altura de línea y familia", () => {
  assert.deepEqual(font('600 64px "Segoe UI", "Microsoft YaHei", sans-serif'), { fontWeight: 600, fontSize: 64, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif' });
  assert.deepEqual(font("italic bold 20px/1.5 Inter"), { fontStyle: "italic", fontWeight: 700, fontSize: 20, lineHeight: 1.5, fontFamily: "Inter" });
  assert.deepEqual(font("16px/24px monospace"), { fontSize: 16, lineHeight: "24px", fontFamily: "monospace" });
});

test("fontWeight acepta números y palabras clave", () => {
  assert.equal(fontWeight("bold"), 700);
  assert.equal(fontWeight("normal"), 400);
  assert.equal(fontWeight(800), 800);
  assert.equal(fontWeight("300"), 300);
});

test("border: atajo con ancho, estilo y color", () => {
  assert.deepEqual(border("2px solid #fff"), { width: 2, color: "#fff" });
  assert.deepEqual(border("1px solid rgba(0, 0, 0, 0.1)"), { width: 1, color: "rgba(0, 0, 0, 0.1)" });
  assert.equal(border("none"), null);
});
