// Tests de extremo a extremo de la capa React: un proyecto TSX de Remotion se empaqueta con esbuild (react y remotion
// apuntan a los módulos propios), se leen sus composiciones y se compila al formato del motor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, reactComposition } from "./project.mjs";
import { startMeasurer } from "./measure.mjs";
import { compile } from "../compose.mjs";

const fakeMeasure = async (specs) => specs.map((s) => ({ width: s.text.length * s.fontSize * 0.5, lines: 1, normalLineHeight: s.fontSize * 1.25 }));

const PROJECT = `
import React from "react";
import { AbsoluteFill, Composition, Sequence, registerRoot, useCurrentFrame, interpolate, staticFile } from "remotion";
import { Video } from "@remotion/media";

type Props = { title: string };

const Title: React.FC<Props> = ({ title }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#0B1020", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ color: "white", fontSize: 80, opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }) }}>{title}</h1>
      <Sequence from={5}>
        <Video src={staticFile("clip.mp4")} muted style={{ width: 320, height: 180, objectFit: "cover" }} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <>
    <Composition id="Title" component={Title} durationInFrames={20} fps={30} width={1280} height={720} defaultProps={{ title: "Hola" }} />
  </>
);
registerRoot(Root);
`;

test("loadProject empaqueta un proyecto TSX de Remotion y devuelve sus composiciones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fullgpu-project-"));
  writeFileSync(join(dir, "index.tsx"), PROJECT);
  const comps = await loadProject(join(dir, "index.tsx"));
  assert.deepEqual(comps.map((c) => [c.id, c.width, c.height, c.fps, c.durationInFrames]), [["Title", 1280, 720, 30, 20]]);

  const warnings = new Set();
  const comp = reactComposition(comps[0], { props: { title: "Adiós" }, measure: fakeMeasure, warn: (m) => warnings.add(m) });
  const out = await compile(comp, { probe: async () => ({ w: 1920, h: 1080 }) });
  assert.equal(out.frames.length, 20);
  assert.deepEqual(out.scene.texts.map((t) => t.text), ["Adiós"]);
  assert.equal(out.scene.texts[0].fontSize, 80);
  const kinds = (f) => out.frames[f].draws.map((d) => d.kind);
  assert.deepEqual(kinds(0), ["shape"]); // el título empieza con opacidad 0
  assert.deepEqual(kinds(12), ["shape", "text", "video"]);
  assert.equal(out.streams[0].file, "clip.mp4");
  assert.equal(out.streams[0].from, 5);
  assert.deepEqual([...warnings], []);
});

test("loadProject explica qué paquete de Remotion no está soportado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fullgpu-project-"));
  writeFileSync(join(dir, "index.tsx"), `import { Circle } from "@remotion/shapes";\nconsole.log(Circle);`);
  await assert.rejects(loadProject(join(dir, "index.tsx")), /@remotion\/shapes is not supported/);
});

const exe = resolve(fileURLToPath(import.meta.url), "../../../native/target/release/fullgpu-render" + (process.platform === "win32" ? ".exe" : ""));
test("startMeasurer mide con el motor (una petición por texto, en orden)", { skip: existsSync(exe) ? false : "motor no compilado (npm run build)" }, async () => {
  const m = startMeasurer(exe);
  try {
    const [a, b] = await m.measure([
      { text: "Hola", fontSize: 40, weight: 400, font: "Segoe UI" },
      { text: "Hola mundo, esto es largo", fontSize: 40, weight: 400, font: "Segoe UI", maxWidth: 150 },
    ]);
    assert.ok(a.width > 40 && a.lines === 1, JSON.stringify(a));
    assert.ok(b.lines >= 2, JSON.stringify(b));
    assert.ok(a.normalLineHeight > 40);
  } finally {
    await m.close();
  }
});
