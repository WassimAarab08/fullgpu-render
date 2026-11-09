// Tests de la CLI `fullgpu`: argumentos, nombre del binario por plataforma, orden de búsqueda y diagnóstico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve as resolvePath } from "node:path";
import { parseArgs, assetName, binaryCandidates, releaseUrl, inspectFfmpeg, cacheDir, defaultMediaRoot, stillPath, pickComposition, checkLayout, engineMissingMessage } from "./cli.mjs";

test("parseArgs: render con composición, salida y carpeta de medios opcional", () => {
  assert.deepEqual(parseArgs(["render", "video.mjs", "out.mp4"]), { command: "render", entry: "video.mjs", compositionId: undefined, out: "out.mp4", mediaRoot: undefined, props: undefined, json: false });
  assert.equal(parseArgs(["render", "v.mjs", "o.mp4", "--media-root", "assets"]).mediaRoot, "assets");
  assert.equal(parseArgs(["doctor"]).command, "doctor");
  assert.equal(parseArgs(["doctor", "--json"]).json, true);
  assert.equal(parseArgs(["--version"]).command, "version");
  assert.equal(parseArgs([]).command, "help");
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.throws(() => parseArgs(["render", "only-one.mjs"]), /output/);
  assert.throws(() => parseArgs(["render", "a", "b", "c", "d"]), /output/);
  assert.throws(() => parseArgs(["fly"]), /Unknown command/);
});

test("assetName: un binario por sistema y arquitectura soportados", () => {
  assert.equal(assetName("win32", "x64"), "fullgpu-render-windows-x64.exe");
  assert.equal(assetName("linux", "x64"), "fullgpu-render-linux-x64");
  assert.throws(() => assetName("darwin", "arm64"), /NVIDIA/);
});

test("binaryCandidates: variable de entorno, compilación local y caché, en ese orden", () => {
  const c = binaryCandidates({ env: { FULLGPU_BIN: "C:/x/mine.exe" }, root: "/repo", cache: "/cache/0.3.0", platform: "win32", arch: "x64" });
  assert.deepEqual(c, [
    "C:/x/mine.exe",
    "/repo/native/target/release/fullgpu-render.exe",
    "/cache/0.3.0/fullgpu-render-windows-x64.exe",
  ]);
  const l = binaryCandidates({ env: {}, root: "/repo", cache: "/c", platform: "linux", arch: "x64" });
  assert.equal(l[0], "/repo/native/target/release/fullgpu-render");
});

test("releaseUrl apunta al binario de la versión publicada", () => {
  assert.equal(
    releaseUrl("0.3.0", "fullgpu-render-linux-x64"),
    "https://github.com/WassimAarab08/fullgpu-render/releases/download/v0.3.0/fullgpu-render-linux-x64",
  );
});

test("cacheDir: LOCALAPPDATA en Windows, XDG_CACHE_HOME o ~/.cache en Linux", () => {
  assert.equal(cacheDir({ platform: "win32", env: { LOCALAPPDATA: "C:/L" }, home: "C:/U", version: "1.0.0" }), "C:/L/fullgpu-render/1.0.0");
  assert.equal(cacheDir({ platform: "linux", env: { XDG_CACHE_HOME: "/x" }, home: "/h", version: "1.0.0" }), "/x/fullgpu-render/1.0.0");
  assert.equal(cacheDir({ platform: "linux", env: {}, home: "/h", version: "1.0.0" }), "/h/.cache/fullgpu-render/1.0.0");
});

test("inspectFfmpeg detecta NVENC y CUDA en la salida de ffmpeg", () => {
  const encoders = " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)\n V....D libx264 ...";
  const hwaccels = "Hardware acceleration methods:\ncuda\nd3d11va\n";
  assert.deepEqual(inspectFfmpeg(encoders, hwaccels), { nvenc: true, cuda: true });
  assert.deepEqual(inspectFfmpeg(" V..... libx264", "Hardware acceleration methods:\nvaapi\n"), { nvenc: false, cuda: false });
});

test("parseArgs: proyecto React/Remotion con id de composición, props JSON y carpeta public", () => {
  assert.deepEqual(parseArgs(["render", "src/index.tsx", "Bench", "out.mp4", "--json"]), {
    command: "render", entry: "src/index.tsx", compositionId: "Bench", out: "out.mp4", mediaRoot: undefined, props: undefined, json: true,
  });
  const a = parseArgs(["render", "src/index.tsx", "Title", "o.mp4", "--props", '{"title":"Hola"}', "--public-dir", "public"]);
  assert.deepEqual(a.props, { title: "Hola" });
  assert.equal(a.mediaRoot, "public");
  assert.throws(() => parseArgs(["render", "i.tsx", "T", "o.mp4", "--props", "{no"]), /--props/);
});

test("defaultMediaRoot: --media-root si se da; si no, public/ del proyecto (como Remotion) o la carpeta actual", () => {
  assert.equal(defaultMediaRoot({ mediaRoot: "assets", react: true, cwd: "/p", exists: () => true }), resolvePath("/p", "assets"));
  assert.equal(defaultMediaRoot({ react: true, cwd: "/p", exists: (d) => d.endsWith("public") }), resolvePath("/p", "public"));
  assert.equal(defaultMediaRoot({ react: true, cwd: "/p", exists: () => false }), resolvePath("/p"));
  assert.equal(defaultMediaRoot({ react: false, cwd: "/p", exists: () => true }), resolvePath("/p"));
});

test("parseArgs: still con uno o varios fotogramas, compositions y check", () => {
  const a = parseArgs(["still", "src/index.tsx", "Promo", "shot.png", "--frame", "0,45,90"]);
  assert.deepEqual([a.command, a.entry, a.compositionId, a.out, a.frames], ["still", "src/index.tsx", "Promo", "shot.png", [0, 45, 90]]);
  assert.deepEqual(parseArgs(["still", "v.mjs", "shot.png"]).frames, [0]);
  assert.throws(() => parseArgs(["still", "v.mjs", "s.png", "--frame", "x"]), /--frame/);
  assert.throws(() => parseArgs(["still", "v.mjs"]), /output/);
  assert.deepEqual(parseArgs(["compositions", "src/index.tsx", "--json"]), { command: "compositions", entry: "src/index.tsx", json: true });
  const c = parseArgs(["check", "src/index.tsx", "Promo", "--public-dir", "public"]);
  assert.deepEqual([c.command, c.entry, c.compositionId, c.mediaRoot, c.json], ["check", "src/index.tsx", "Promo", "public", false]);
  assert.equal(parseArgs(["check", "v.mjs"]).compositionId, undefined);
  assert.throws(() => parseArgs(["compositions"]), /entry/);
});

test("stillPath: un fotograma usa el nombre tal cual; varios llevan el número", () => {
  assert.equal(stillPath("out/shot.png", 45, false), "out/shot.png");
  assert.equal(stillPath("out/shot.png", 45, true), "out/shot-45.png");
  assert.equal(stillPath("shot", 3, true), "shot-3.png");
});

test("pickComposition: por id, la única si no se da id, y error con las disponibles", () => {
  const comps = [{ id: "A" }, { id: "B" }];
  assert.equal(pickComposition(comps, "B").id, "B");
  assert.equal(pickComposition([{ id: "Solo" }], undefined).id, "Solo");
  assert.throws(() => pickComposition(comps, undefined), /A, B/);
  assert.throws(() => pickComposition(comps, "C"), /No composition "C".*A, B/);
});

test("checkLayout: medios que faltan y fotogramas con demasiadas primitivas", () => {
  const layout = {
    streams: [{ file: "clip.mp4" }],
    images: [{ file: "logo.png" }],
    audio: { file: "voz.mp3" },
    frames: [{ draws: new Array(3) }, { draws: new Array(600) }],
  };
  const r = checkLayout(layout, { exists: (f) => f.endsWith("clip.mp4"), mediaRoot: "/m" });
  assert.deepEqual(r.missing, ["logo.png", "voz.mp3"]);
  assert.equal(r.maxDraws, 600);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.at(-1), /600 draws in frame 1.*512/);
  assert.deepEqual(checkLayout({ streams: [], images: [], audio: null, frames: [{ draws: [] }] }, { exists: () => true, mediaRoot: "/m" }).errors, []);
});

test("la CLI arranca también a través de un enlace simbólico (npm link, instalación local, pnpm)", async () => {
  const { mkdtempSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const link = join(mkdtempSync(join(tmpdir(), "fullgpu-link-")), "sdk");
  symlinkSync(fileURLToPath(new URL(".", import.meta.url)), link, "junction");
  const r = spawnSync(process.execPath, [join(link, "cli.mjs"), "--version"], { encoding: "utf8" });
  assert.match(r.stdout, /^\d+\.\d+\.\d+/, `stdout: ${JSON.stringify(r.stdout)} stderr: ${r.stderr}`);
});

test("engineMissingMessage explica cómo seguir cuando no hay binario para la versión", () => {
  const m = engineMissingMessage("0.9.0", 404);
  assert.match(m, /v0\.9\.0/);
  assert.match(m, /FULLGPU_BIN/);
});
