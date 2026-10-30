// Tests de la CLI `fullgpu`: argumentos, nombre del binario por plataforma, orden de búsqueda y diagnóstico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve as resolvePath } from "node:path";
import { parseArgs, assetName, binaryCandidates, releaseUrl, inspectFfmpeg, cacheDir, defaultMediaRoot } from "./cli.mjs";

test("parseArgs: render con composición, salida y carpeta de medios opcional", () => {
  assert.deepEqual(parseArgs(["render", "video.mjs", "out.mp4"]), { command: "render", entry: "video.mjs", out: "out.mp4", mediaRoot: undefined });
  assert.deepEqual(parseArgs(["render", "v.mjs", "o.mp4", "--media-root", "assets"]).mediaRoot, "assets");
  assert.equal(parseArgs(["doctor"]).command, "doctor");
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
  assert.deepEqual(parseArgs(["render", "src/index.tsx", "Bench", "out.mp4"]), {
    command: "render", entry: "src/index.tsx", compositionId: "Bench", out: "out.mp4", mediaRoot: undefined, props: undefined,
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
