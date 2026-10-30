// Tests del núcleo de animación. Comprueban el comportamiento y, si remotion-baseline tiene instalado Remotion,
// que los valores coinciden con los suyos (misma API, implementación propia).
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate, spring, measureSpring, Easing, interpolateColors } from "./animation.mjs";

let R = null;
try {
  R = await import("../remotion-baseline/node_modules/remotion/dist/esm/index.mjs");
  if (typeof R.interpolate !== "function") R = null;
} catch {
  R = null;
}
const oracle = { skip: R ? false : "Remotion no instalado (cd remotion-baseline && npm install)" };
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} != ${b}`);

test("interpolate: tramos, extrapolación y easing", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(15, [0, 10], [0, 100]), 150);
  assert.equal(interpolate(15, [0, 10], [0, 100], { extrapolateRight: "clamp" }), 100);
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp" }), 0);
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "identity" }), -5);
  assert.equal(interpolate(15, [0, 10, 20], [0, 100, 0]), 50);
  assert.equal(interpolate(5, [0, 10], [0, 100], { easing: Easing.in(Easing.quad) }), 25);
  assert.throws(() => interpolate(1, [0, 0], [0, 1]));
  assert.throws(() => interpolate(1, [0, 1], [0]));
});

test("spring: empieza en from, termina en to y rebota con poca amortiguación", () => {
  assert.equal(spring({ frame: 0, fps: 30 }), 0);
  close(spring({ frame: 300, fps: 30 }), 1, 1e-4);
  const max = Math.max(...Array.from({ length: 60 }, (_, f) => spring({ frame: f, fps: 30 })));
  assert.ok(max > 1.05, "debería sobrepasar 1 con damping 10");
  const clamped = Array.from({ length: 60 }, (_, f) => spring({ frame: f, fps: 30, config: { overshootClamping: true } }));
  assert.ok(Math.max(...clamped) <= 1);
  close(spring({ frame: 10, fps: 30, from: 20, to: 40, delay: 5 }), 20 + 20 * spring({ frame: 5, fps: 30 }), 1e-9);
});

test("spring con durationInFrames llega al reposo en esa duración", () => {
  const v = spring({ frame: 45, fps: 30, durationInFrames: 45, config: { damping: 200 } });
  close(v, 1, 0.01);
  assert.ok(measureSpring({ fps: 30 }) > 10);
});

test("Easing: extremos fijos y curvas conocidas", () => {
  for (const e of [Easing.linear, Easing.quad, Easing.cubic, Easing.sin, Easing.circle, Easing.exp, Easing.ease, Easing.bezier(0.33, 1, 0.68, 1)]) {
    close(e(0), 0, 1e-3);
    close(e(1), 1, 1e-3);
  }
  close(Easing.out(Easing.quad)(0.5), 0.75, 1e-9);
  close(Easing.inOut(Easing.cubic)(0.25), 0.0625, 1e-9);
  assert.ok(Easing.back(1.7)(0.2) < 0, "back retrocede al principio");
  close(Easing.bounce(1), 1, 1e-9);
});

test("interpolateColors mezcla en RGB y respeta el alfa", () => {
  assert.equal(interpolateColors(5, [0, 10], ["#000000", "#ffffff"]), "rgba(128, 128, 128, 1)");
  assert.equal(interpolateColors(0, [0, 10], ["rgba(255, 0, 0, 0.5)", "blue"]), "rgba(255, 0, 0, 0.5)");
});

test("coincide con interpolate de Remotion", oracle, () => {
  const cases = [
    [3.3, [0, 10], [0, 100], {}],
    [12, [0, 10, 20], [5, -5, 40], { extrapolateRight: "clamp" }],
    [7, [0, 10], [0, 1], { easing: R?.Easing.bezier(0.33, 1, 0.68, 1) }],
    [7, [0, 10], [0, 1], { easing: R?.Easing.inOut(R?.Easing.ease) }],
  ];
  for (const [x, i, o, opts] of cases) {
    const mine = { ...opts };
    if (opts.easing === cases[2][3].easing && opts.easing) mine.easing = Easing.bezier(0.33, 1, 0.68, 1);
    if (opts.easing === cases[3][3].easing && opts.easing) mine.easing = Easing.inOut(Easing.ease);
    close(interpolate(x, i, o, mine), R.interpolate(x, i, o, opts), 1e-6, JSON.stringify([x, i, o]));
  }
});

test("coincide con spring de Remotion en varias configuraciones", oracle, () => {
  const configs = [{}, { damping: 200 }, { damping: 12, mass: 0.5, stiffness: 200 }, { damping: 30, stiffness: 50 }, { overshootClamping: true }];
  for (const config of configs) {
    for (const fps of [30, 60]) {
      for (let frame = 0; frame < 90; frame += 7) {
        close(spring({ frame, fps, config }), R.spring({ frame, fps, config }), 1e-6, JSON.stringify({ config, fps, frame }));
      }
    }
  }
});

test("coincide con spring de Remotion con durationInFrames, delay y from/to", oracle, () => {
  for (let frame = 0; frame < 80; frame += 5) {
    const o = { frame, fps: 30, durationInFrames: 40, delay: 10, from: -50, to: 50, config: { damping: 15 } };
    close(spring(o), R.spring(o), 1e-3, `f=${frame}`);
  }
  close(measureSpring({ fps: 30, config: { damping: 15 } }), R.measureSpring({ fps: 30, config: { damping: 15 } }), 0);
});

test("coincide con las curvas Easing de Remotion", oracle, () => {
  const pairs = [
    [Easing.elastic(1), R?.Easing.elastic(1)],
    [Easing.back(1.70158), R?.Easing.back(1.70158)],
    [Easing.bounce, R?.Easing.bounce],
    [Easing.out(Easing.exp), R?.Easing.out(R?.Easing.exp)],
    [Easing.poly(4), R?.Easing.poly(4)],
  ];
  for (const [mine, theirs] of pairs) {
    for (let t = 0; t <= 1; t += 0.1) close(mine(t), theirs(t), 1e-6, `t=${t}`);
  }
});

test("coincide con interpolateColors de Remotion", oracle, () => {
  for (const x of [0, 2.5, 5, 10]) {
    assert.equal(interpolateColors(x, [0, 10], ["#ff6600", "rgba(0, 128, 255, 0.4)"]), R.interpolateColors(x, [0, 10], ["#ff6600", "rgba(0, 128, 255, 0.4)"]));
  }
});
