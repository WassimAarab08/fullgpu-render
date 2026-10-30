// Tests de la capa React: el runtime JSX propio y los módulos compatibles con `remotion` y `@remotion/media`.
// Cada fotograma se evalúa de forma pura (como Remotion renderizando fotogramas sueltos en paralelo) y sale un árbol
// de nodos anfitrión: { type: "div" | "img" | "video" | "audio" | "#text", props, children }.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement as h, Fragment, useMemo, useState, useRef, useCallback, createContext, useContext, memo, forwardRef } from "./react.mjs";
import { jsx, jsxs } from "./jsx-runtime.mjs";
import {
  AbsoluteFill, Sequence, Series, Loop, Freeze, Img, Video as OldVideo, OffthreadVideo, Audio, staticFile,
  Composition, Folder, registerRoot, useCurrentFrame, useVideoConfig, interpolate, spring,
} from "./remotion.mjs";
import { Video } from "./media.mjs";
import { renderFrame, getCompositions } from "./runtime.mjs";

const CONFIG = { id: "T", width: 1920, height: 1080, fps: 30, durationInFrames: 300 };
const at = (el, frame) => renderFrame(el, { ...CONFIG, frame });
const texts = (nodes) => nodes.flatMap((n) => (n.type === "#text" ? [n.text] : texts(n.children)));
const find = (nodes, type) => nodes.flatMap((n) => [...(n.type === type ? [n] : []), ...find(n.children ?? [], type)]);

test("elementos: jsx y createElement, fragmentos aplanados, hijos falsos ignorados y números como texto", () => {
  const el = jsxs("div", { style: { color: "red" }, children: [jsx(Fragment, { children: ["a", null, false, 3] }), "", undefined, h("span", null, "b")] });
  const [div] = at(el, 0);
  assert.equal(div.type, "div");
  assert.deepEqual(div.props.style, { color: "red" });
  assert.equal(div.props.children, undefined);
  assert.deepEqual(texts([div]), ["a", "3", "b"]);
  assert.equal(React.createElement, h);
});

test("componentes de función con props, children y hooks válidos durante el render", () => {
  let renders = 0;
  const Box = ({ label, children }) => {
    const twice = useMemo(() => label + label, [label]);
    const [count] = useState(() => 7);
    const ref = useRef(5);
    const cb = useCallback(() => ref.current, []);
    renders++;
    return h("div", null, `${twice}-${count}-${cb()}`, children);
  };
  const [div] = at(h(Box, { label: "x" }, h("span", null, "hijo")), 0);
  assert.deepEqual(texts([div]), ["xx-7-5", "hijo"]);
  assert.equal(renders, 1);
});

test("contexto: Provider y useContext, con valor por defecto fuera del Provider", () => {
  const Theme = createContext("claro");
  const Show = () => h("div", null, useContext(Theme));
  const tree = h(Fragment, null, h(Show), h(Theme.Provider, { value: "oscuro" }, h(Show)));
  assert.deepEqual(texts(at(tree, 0)), ["claro", "oscuro"]);
});

test("memo y forwardRef renderizan el componente envuelto", () => {
  const A = memo(({ t }) => h("div", null, t));
  const B = forwardRef(({ t }, ref) => h("div", null, `${t}${ref === null ? "" : "!"}`));
  assert.deepEqual(texts(at(h(Fragment, null, h(A, { t: "m" }), h(B, { t: "f" })), 0)), ["m", "f"]);
});

test("useCurrentFrame y Sequence: desplaza el tiempo, recorta fuera de su tramo y se anida", () => {
  const F = () => h("div", null, String(useCurrentFrame()));
  const tree = h(Fragment, null,
    h(F),
    h(Sequence, { from: 10, durationInFrames: 20 }, h(F), h(Sequence, { from: 5 }, h(F))),
  );
  assert.deepEqual(texts(at(tree, 3)), ["3"]);
  assert.deepEqual(texts(at(tree, 12)), ["12", "2"]);
  assert.deepEqual(texts(at(tree, 16)), ["16", "6", "1"]);
  assert.deepEqual(texts(at(tree, 30)), ["30"]);
});

test("Sequence envuelve en un AbsoluteFill salvo con layout=\"none\"", () => {
  const [wrap] = at(h(Sequence, { style: { opacity: 0.5 } }, "x"), 0);
  assert.equal(wrap.type, "div");
  assert.equal(wrap.props.style.position, "absolute");
  assert.equal(wrap.props.style.opacity, 0.5);
  assert.deepEqual(at(h(Sequence, { layout: "none" }, "x"), 0).map((n) => n.type), ["#text"]);
});

test("useVideoConfig: datos de la composición, con la duración de la Sequence si está dentro", () => {
  let seen;
  const C = () => ((seen = useVideoConfig()), null);
  at(h(C), 0);
  assert.equal(seen.width, 1920);
  assert.equal(seen.fps, 30);
  assert.equal(seen.durationInFrames, 300);
  assert.equal(seen.id, "T");
  at(h(Sequence, { from: 0, durationInFrames: 40 }, h(C)), 0);
  assert.equal(seen.durationInFrames, 40);
});

test("Series encadena tramos y respeta offset", () => {
  const F = ({ n }) => h("div", null, `${n}:${useCurrentFrame()}`);
  const tree = h(Series, null,
    h(Series.Sequence, { durationInFrames: 10 }, h(F, { n: "a" })),
    h(Series.Sequence, { durationInFrames: 10, offset: 5 }, h(F, { n: "b" })),
  );
  assert.deepEqual(texts(at(tree, 9)), ["a:9"]);
  assert.deepEqual(texts(at(tree, 12)), []);
  assert.deepEqual(texts(at(tree, 15)), ["b:0"]);
});

test("Loop repite y Freeze congela el fotograma", () => {
  const F = () => h("div", null, String(useCurrentFrame()));
  assert.deepEqual(texts(at(h(Loop, { durationInFrames: 10, layout: "none" }, h(F)), 23)), ["3"]);
  assert.deepEqual(texts(at(h(Loop, { durationInFrames: 10, times: 2, layout: "none" }, h(F)), 23)), []);
  assert.deepEqual(texts(at(h(Freeze, { frame: 4 }, h(F)), 50)), ["4"]);
});

test("AbsoluteFill ocupa el lienzo como flex en columna y mezcla el style del usuario", () => {
  const [fill] = at(h(AbsoluteFill, { style: { background: "#fff", flexDirection: "row" } }), 0);
  assert.equal(fill.props.style.position, "absolute");
  assert.equal(fill.props.style.top, 0);
  assert.equal(fill.props.style.display, "flex");
  assert.equal(fill.props.style.flexDirection, "row");
  assert.equal(fill.props.style.background, "#fff");
});

test("Video de @remotion/media dentro de una Sequence: inicio absoluto, trimBefore en segundos y velocidad", () => {
  const tree = h(Sequence, { from: 30, durationInFrames: 60 }, h(Video, { src: staticFile("clip.mp4"), trimBefore: 15, playbackRate: 2, muted: true, style: { width: "100%" } }));
  assert.deepEqual(at(tree, 29), []);
  const [v] = find(at(tree, 40), "video");
  assert.equal(v.props.src, "clip.mp4");
  assert.deepEqual(v.media, { start: 30, end: 90, startFromSec: 0.5, rate: 2, muted: true, volume: 1 });
  assert.deepEqual(v.props.style, { width: "100%" });
});

test("Video y OffthreadVideo de remotion aceptan startFrom (fotogramas); Img y Audio llegan como nodos", () => {
  const [v1] = find(at(h(OldVideo, { src: "a.mp4", startFrom: 30 }), 0), "video");
  assert.equal(v1.media.startFromSec, 1);
  const [v2] = find(at(h(OffthreadVideo, { src: "/b.mp4", trimBefore: 60 }), 0), "video");
  assert.equal(v2.media.startFromSec, 2);
  assert.equal(v2.props.src, "b.mp4");
  const [img] = find(at(h(Img, { src: staticFile("logo.png"), style: { width: 10 } }), 0), "img");
  assert.equal(img.props.src, "logo.png");
  const [a] = find(at(h(Sequence, { from: 3 }, h(Audio, { src: "voz.mp3", volume: 0.5 })), 5), "audio");
  assert.deepEqual(a.media, { start: 3, end: 300, startFromSec: 0, rate: 1, muted: false, volume: 0.5 });
});

test("staticFile quita la barra inicial y codifica nada: la ruta se resuelve desde la carpeta de medios", () => {
  assert.equal(staticFile("phone.mp4"), "phone.mp4");
  assert.equal(staticFile("/img/x.png"), "img/x.png");
});

test("registerRoot y Composition: getCompositions devuelve metadatos y el componente con defaultProps", () => {
  const Comp = ({ who }) => h("div", null, `hola ${who}`);
  registerRoot(() => h(Folder, { name: "f" }, h(Composition, { id: "A", component: Comp, durationInFrames: 90, fps: 30, width: 1280, height: 720, defaultProps: { who: "mundo" } }), h(Composition, { id: "B", component: Comp, durationInFrames: 1, fps: 25, width: 10, height: 10 })));
  const comps = getCompositions();
  assert.deepEqual(comps.map((c) => c.id), ["A", "B"]);
  const a = comps[0];
  assert.deepEqual([a.width, a.height, a.fps, a.durationInFrames], [1280, 720, 30, 90]);
  assert.deepEqual(texts(renderFrame(h(a.component, a.defaultProps), { ...a, frame: 0 })), ["hola mundo"]);
});

test("interpolate y spring se reexportan con la firma de Remotion", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(spring({ frame: 0, fps: 30 }), 0);
  assert.ok(spring({ frame: 60, fps: 30 }) > 0.99);
});

test("random() es determinista y coincide con el de Remotion", async (t) => {
  const { random } = await import("./remotion.mjs");
  assert.equal(random("a"), random("a"));
  assert.notEqual(random(1), random(2));
  let R = null;
  try {
    R = await import("../../remotion-baseline/node_modules/remotion/dist/esm/index.mjs");
  } catch {
    return t.skip("Remotion no instalado (cd remotion-baseline && npm install)");
  }
  for (const seed of ["fondo", "particula-12", 0, 1, 42, 3.5]) assert.equal(random(seed), R.random(seed), `semilla ${seed}`);
});
