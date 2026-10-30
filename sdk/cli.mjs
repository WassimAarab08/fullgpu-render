#!/usr/bin/env node
// CLI `fullgpu`: renderiza composiciones del SDK y comprueba el entorno.
//   fullgpu render <composición.mjs> <salida.mp4> [--media-root <carpeta>]
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
  fullgpu doctor
  fullgpu --version

Media paths in a composition (video, image, audio src) resolve from --media-root (default: current directory).`;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return { command: "help" };
  if (cmd === "--version" || cmd === "-v") return { command: "version" };
  if (cmd === "doctor") return { command: "doctor" };
  if (cmd === "render") {
    const positional = [];
    let mediaRoot;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--media-root") mediaRoot = rest[++i];
      else positional.push(rest[i]);
    }
    if (positional.length !== 2) throw new Error("render needs a composition file and an output .mp4");
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

async function render({ entry, out, mediaRoot }) {
  const { compile } = await import("./compose.mjs");
  const t0 = performance.now();
  const comp = (await import(pathToFileURL(resolve(entry)).href)).default;
  if (!comp?.render) throw new Error(`${entry} must export default a composition(...)`);
  const root = resolve(mediaRoot ?? process.cwd());
  const layout = await compile(comp, { mediaRoot: root });
  const dir = join(tmpdir(), "fullgpu-render");
  mkdirSync(dir, { recursive: true });
  const layoutPath = join(dir, `${basename(entry, ".mjs")}-${process.pid}.layout.json`);
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
  checks.push([!!bin, bin ? `Engine: ${bin}` : "Engine not downloaded yet", "It downloads on the first render, or run: npm run build"]);
  for (const [ok, label, fix] of checks) console.log(`${ok ? "ok  " : "fail"}  ${label}${ok ? "" : `\n      ${fix}`}`);
  return checks.every(([ok], i) => ok || i === checks.length - 1);
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
