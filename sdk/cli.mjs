#!/usr/bin/env node
// CLI `fullgpu`: renderiza composiciones del SDK o proyectos React/Remotion y comprueba el entorno.
//   fullgpu render <composición.mjs> <salida.mp4> [--media-root <carpeta>]
//   fullgpu render <src/index.tsx> <IdComposición> <salida.mp4> [--props <json>] [--public-dir <carpeta>]
//   fullgpu doctor
// El binario nativo se busca en FULLGPU_BIN, en native/target/release (compilación local) y en la caché del usuario;
// si no está, se descarga de la release de GitHub que corresponde a la versión del paquete.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const REPO = "WassimAarab08/fullgpu-render";
const USAGE = `Usage:
  fullgpu render <composition.mjs> <out.mp4> [--media-root <dir>]
  fullgpu render <src/index.tsx> <CompositionId> <out.mp4> [--props <json>] [--public-dir <dir>]
  fullgpu doctor
  fullgpu --version

Media paths (video, image, audio src, staticFile()) resolve from --media-root / --public-dir
(default: ./public for React projects if it exists, otherwise the current directory).`;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return { command: "help" };
  if (cmd === "--version" || cmd === "-v") return { command: "version" };
  if (cmd === "doctor") return { command: "doctor" };
  if (cmd === "render") {
    const positional = [];
    let mediaRoot;
    let props;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--media-root" || rest[i] === "--public-dir") mediaRoot = rest[++i];
      else if (rest[i] === "--props") {
        try {
          props = JSON.parse(rest[++i]);
        } catch {
          throw new Error("--props must be valid JSON");
        }
      } else positional.push(rest[i]);
    }
    if (positional.length === 3) return { command: "render", entry: positional[0], compositionId: positional[1], out: positional[2], mediaRoot, props };
    if (positional.length !== 2) throw new Error("render needs a composition file and an output .mp4 (or an entry, a composition id and an output .mp4)");
    return { command: "render", entry: positional[0], out: positional[1], mediaRoot };
  }
  throw new Error(`Unknown command: ${cmd}`);
}

export function assetName(platform, arch) {
  if (arch === "x64" && platform === "win32") return "fullgpu-render-windows-x64.exe";
  if (arch === "x64" && platform === "linux") return "fullgpu-render-linux-x64";
  throw new Error(`No prebuilt engine for ${platform}-${arch}: fullgpu-render needs an NVIDIA GPU on Windows or Linux (x64)`);
}

export function binaryCandidates({ env, root, cache, platform, arch }) {
  const exe = platform === "win32" ? ".exe" : "";
  const list = [];
  if (env.FULLGPU_BIN) list.push(env.FULLGPU_BIN);
  list.push(`${root}/native/target/release/fullgpu-render${exe}`);
  list.push(`${cache}/${assetName(platform, arch)}`);
  return list;
}

export const releaseUrl = (version, asset) => `https://github.com/${REPO}/releases/download/v${version}/${asset}`;

export function cacheDir({ platform, env, home, version }) {
  const base = platform === "win32" ? env.LOCALAPPDATA ?? `${home}/AppData/Local` : env.XDG_CACHE_HOME ?? `${home}/.cache`;
  return `${base}/fullgpu-render/${version}`;
}

export function inspectFfmpeg(encoders, hwaccels) {
  return { nvenc: /\bh264_nvenc\b/.test(encoders), cuda: /^\s*cuda\s*$/m.test(hwaccels) };
}

/** Carpeta desde la que se resuelven los medios: la indicada, public/ en proyectos React (como Remotion) o la actual. */
export function defaultMediaRoot({ mediaRoot, react, cwd, exists }) {
  if (mediaRoot) return resolve(cwd, mediaRoot);
  if (react && exists(join(cwd, "public"))) return join(resolve(cwd), "public");
  return resolve(cwd);
}

const version = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

async function findBinary({ download = true } = {}) {
  const cache = cacheDir({ platform: process.platform, env: process.env, home: homedir(), version: version() });
  const candidates = binaryCandidates({ env: process.env, root: ROOT, cache, platform: process.platform, arch: process.arch });
  const found = candidates.find((p) => existsSync(p));
  if (found || !download) return found;
  const target = candidates.at(-1);
  const url = releaseUrl(version(), basename(target));
  console.error(`Downloading the engine (${basename(target)}) from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the engine (${res.status}). Build it with: npm run build`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== "win32") chmodSync(target, 0o755);
  return target;
}

async function loadReact({ entry, compositionId, props }, exe) {
  const { loadProject, reactComposition } = await import("./react/project.mjs");
  const { startMeasurer } = await import("./react/measure.mjs");
  const comps = await loadProject(resolve(entry));
  const info = comps.find((c) => c.id === compositionId);
  if (!info) throw new Error(`No composition "${compositionId}" in ${entry} (found: ${comps.map((c) => c.id).join(", ") || "none"})`);
  if (info.calculateMetadata) {
    const meta = await info.calculateMetadata({ defaultProps: info.defaultProps, props: { ...info.defaultProps, ...props }, abortSignal: new AbortController().signal, compositionId });
    Object.assign(info, Object.fromEntries(Object.entries(meta ?? {}).filter(([k, v]) => v != null && k !== "props")));
    if (meta?.props) props = meta.props;
  }
  const measurer = startMeasurer(exe);
  const warnings = new Set();
  const comp = reactComposition(info, { props, measure: measurer.measure, warn: (m) => warnings.add(m) });
  return { comp, warnings, done: measurer.close };
}

async function render(args) {
  const { entry, out, compositionId } = args;
  const { compile } = await import("./compose.mjs");
  const t0 = performance.now();
  const root = defaultMediaRoot({ mediaRoot: args.mediaRoot, react: !!compositionId, cwd: process.cwd(), exists: existsSync });
  let comp;
  let react = null;
  if (compositionId) {
    react = await loadReact(args, await findBinary());
    comp = react.comp;
  } else {
    comp = (await import(pathToFileURL(resolve(entry)).href)).default;
    if (!comp?.render) throw new Error(`${entry} must export default a composition(...)`);
  }
  let layout;
  try {
    layout = await compile(comp, { mediaRoot: root });
  } finally {
    await react?.done();
  }
  for (const w of react?.warnings ?? []) console.error(`warning: ${w}`);
  const dir = join(tmpdir(), "fullgpu-render");
  mkdirSync(dir, { recursive: true });
  const layoutPath = join(dir, `${compositionId ?? basename(entry, ".mjs")}-${process.pid}.layout.json`);
  writeFileSync(layoutPath, JSON.stringify(layout));
  const compileMs = performance.now() - t0;
  const exe = await findBinary();
  const r = spawnSync(exe, [layoutPath, root, resolve(out)], { stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`The engine exited with code ${r.status}`);
  const stats = JSON.parse(String(r.stdout || "{}"));
  console.log(
    `${out}: ${layout.frames.length} frames, compiled in ${(compileMs / 1000).toFixed(1)} s, rendered at ${Math.round(stats.fps ?? 0)} fps (total ${((performance.now() - t0) / 1000).toFixed(1)} s)`,
  );
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

async function doctor() {
  const checks = [];
  const node = Number(process.versions.node.split(".")[0]);
  checks.push([node >= 22, `Node ${process.versions.node}`, "Node 22 or newer is required"]);
  const gpu = run("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]);
  checks.push([!!gpu, gpu ? `NVIDIA GPU: ${gpu.trim().split("\n")[0]}` : "No NVIDIA GPU found", "Install an NVIDIA driver (nvidia-smi must work)"]);
  const enc = run("ffmpeg", ["-hide_banner", "-encoders"]);
  const hw = run("ffmpeg", ["-hide_banner", "-hwaccels"]);
  const ff = enc && hw ? inspectFfmpeg(enc, hw) : null;
  checks.push([!!ff, ff ? "ffmpeg found" : "ffmpeg not found", "Install ffmpeg and put it on the PATH"]);
  checks.push([!!ff?.nvenc, "ffmpeg has h264_nvenc", "Use an ffmpeg build with NVENC (e.g. gyan.dev full on Windows)"]);
  checks.push([!!ff?.cuda, "ffmpeg has CUDA decoding", "Use an ffmpeg build with CUDA hwaccel"]);
  const bin = await findBinary({ download: false });
  checks.push([!!bin, bin ? `Engine: ${bin}` : "Engine not downloaded yet", "It downloads on the first render (or build it: npm run build)", true]);
  for (const [ok, label, fix, optional] of checks) {
    console.log(`${ok ? "ok  " : optional ? "note" : "fail"}  ${label}${ok ? "" : `\n      ${fix}`}`);
  }
  return checks.every(([ok, , , optional]) => ok || optional);
}

export async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  try {
    if (args.command === "help") console.log(USAGE);
    else if (args.command === "version") console.log(version());
    else if (args.command === "doctor") process.exit((await doctor()) ? 0 : 1);
    else await render(args);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

const cliArg = process.argv[1] ? resolve(process.argv[1]) : "";
if (cliArg === fileURLToPath(import.meta.url) || /[\\/]fullgpu(\.cmd|\.ps1)?$/.test(cliArg)) main();
