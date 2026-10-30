#!/usr/bin/env node
// CLI `fullgpu`: renderiza composiciones del SDK o proyectos React/Remotion, saca fotogramas sueltos, revisa un proyecto
// sin renderizarlo y comprueba el entorno. Con --json cada orden escribe un único objeto JSON en stdout (para agentes y
// scripts); los avisos del motor van a stderr.
// El binario nativo se busca en FULLGPU_BIN, en native/target/release (compilación local) y en la caché del usuario;
// si no está, se descarga de la release de GitHub que corresponde a la versión del paquete.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { resolve, dirname, join, basename, extname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const REPO = "WassimAarab08/fullgpu-render";
const MAX_DRAWS = 512;
export const USAGE = `Usage:
  fullgpu render <entry> [CompositionId] <out.mp4>         render a video
  fullgpu still <entry> [CompositionId] <out.png> [--frame N[,N...]]
                                                           render single frames as PNG (default: frame 0)
  fullgpu compositions <entry>                             list compositions (id, size, fps, duration)
  fullgpu check <entry> [CompositionId]                    compile every frame without rendering: unsupported
                                                           features, missing media, draw limits
  fullgpu doctor                                           check GPU, ffmpeg and the engine
  fullgpu --version

<entry> is an SDK composition (.mjs with \`export default composition(...)\`) or a Remotion entry file
(.tsx/.jsx/.ts/.js that calls registerRoot). CompositionId is needed when the entry registers more than one.

Options:
  --props <json>        input props for a Remotion composition
  --public-dir <dir>    where media paths and staticFile() resolve (alias: --media-root)
                        default: ./public for Remotion entries if it exists, otherwise the current directory
  --json                print one JSON object on stdout ({ "ok": true|false, ... })`;

const COMMANDS = {
  render: { positional: [2, 3], out: true },
  still: { positional: [2, 3], out: true },
  check: { positional: [1, 2] },
  compositions: { positional: [1, 1] },
};

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return { command: "help" };
  if (cmd === "--version" || cmd === "-v") return { command: "version" };
  const json = rest.includes("--json");
  if (cmd === "doctor") return { command: "doctor", json };
  const spec = COMMANDS[cmd];
  if (!spec) throw new Error(`Unknown command: ${cmd}`);

  const positional = [];
  let mediaRoot;
  let props;
  let frames = [0];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") continue;
    if (a === "--media-root" || a === "--public-dir") mediaRoot = rest[++i];
    else if (a === "--props") {
      try {
        props = JSON.parse(rest[++i]);
      } catch {
        throw new Error("--props must be valid JSON");
      }
    } else if (a === "--frame" || a === "--frames") {
      frames = String(rest[++i]).split(",").map((n) => Number(n.trim()));
      if (!frames.every((n) => Number.isInteger(n) && n >= 0)) throw new Error("--frame takes frame numbers: --frame 0 or --frame 0,45,90");
    } else positional.push(a);
  }
  if (!positional.length) throw new Error(`${cmd} needs an entry file`);
  const [min, max] = spec.positional;
  if (positional.length < min || positional.length > max) {
    throw new Error(spec.out ? `${cmd} needs an entry file, an optional composition id and an output file` : `${cmd} takes an entry file and an optional composition id`);
  }
  if (cmd === "compositions") return { command: cmd, entry: positional[0], json };
  const [entry, ...more] = positional;
  const out = spec.out ? more.pop() : undefined;
  const base = { command: cmd, entry, compositionId: more[0], out, mediaRoot, props, json };
  if (cmd === "check") delete base.out;
  if (cmd === "still") base.frames = frames;
  return base;
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

/** Nombre de cada PNG de `still`: el indicado si es un solo fotograma; con varios, `nombre-<fotograma>.png`. */
export function stillPath(out, frame, many) {
  if (!many) return out;
  const ext = extname(out) || ".png";
  return `${out.slice(0, out.length - extname(out).length)}-${frame}${ext}`;
}

/** La composición pedida, o la única si no se indica id. */
export function pickComposition(comps, id) {
  const ids = comps.map((c) => c.id).join(", ") || "none";
  if (id == null) {
    if (comps.length === 1) return comps[0];
    throw new Error(`The entry registers several compositions, pass one of: ${ids}`);
  }
  const found = comps.find((c) => c.id === id);
  if (!found) throw new Error(`No composition "${id}" (found: ${ids})`);
  return found;
}

/** Revisión de un layout compilado: medios que no existen y fotogramas por encima del límite de primitivas del motor. */
export function checkLayout(layout, { exists, mediaRoot }) {
  const files = [...layout.streams.map((s) => s.file), ...(layout.images ?? []).map((i) => i.file), ...(layout.audio ? [layout.audio.file] : [])];
  const missing = [...new Set(files)].filter((f) => !exists(join(mediaRoot, f)));
  const errors = missing.map((f) => `missing media: ${f} (looked in ${mediaRoot}; point --public-dir at the folder that has it)`);
  let maxDraws = 0;
  let worst = 0;
  layout.frames.forEach((f, i) => {
    if (f.draws.length > maxDraws) [maxDraws, worst] = [f.draws.length, i];
  });
  if (maxDraws > MAX_DRAWS) errors.push(`${maxDraws} draws in frame ${worst}: the engine draws at most ${MAX_DRAWS} per frame`);
  return { missing, maxDraws, errors };
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

/** Composiciones de un punto de entrada: una composición del SDK (.mjs) o un proyecto Remotion empaquetado. */
async function loadEntry(entry) {
  const file = resolve(entry);
  if (!existsSync(file)) throw new Error(`Entry file not found: ${entry}`);
  if (/\.m?js$/.test(file)) {
    let mod = null;
    try {
      mod = await import(pathToFileURL(file).href);
    } catch {
      mod = null; // un .js de Remotion importa "remotion": se empaqueta abajo
    }
    if (mod?.default?.render) {
      const c = mod.default;
      return { kind: "sdk", comps: [{ id: basename(file, extname(file)), width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, comp: c }] };
    }
  }
  const { loadProject } = await import("./react/project.mjs");
  return { kind: "react", comps: await loadProject(file) };
}

const estimateText = async (specs) => specs.map((s) => ({ width: s.text.length * s.fontSize * 0.55, lines: 1, normalLineHeight: s.fontSize * 1.2 }));

/**
 * Prepara la composición a compilar. `download`: si falta el motor, se descarga (render, still) o los textos se
 * estiman sin él (check).
 */
async function prepare(args, { download }) {
  const { kind, comps } = await loadEntry(args.entry);
  const info = pickComposition(comps, args.compositionId);
  const mediaRoot = defaultMediaRoot({ mediaRoot: args.mediaRoot, react: kind === "react", cwd: process.cwd(), exists: existsSync });
  const warnings = new Set();
  if (kind === "sdk") return { info, comp: info.comp, mediaRoot, warnings, done: async () => {} };

  let props = args.props;
  if (info.calculateMetadata) {
    const meta = await info.calculateMetadata({ defaultProps: info.defaultProps, props: { ...info.defaultProps, ...props }, abortSignal: new AbortController().signal, compositionId: info.id });
    Object.assign(info, Object.fromEntries(Object.entries(meta ?? {}).filter(([k, v]) => v != null && k !== "props")));
    if (meta?.props) props = meta.props;
  }
  const { reactComposition } = await import("./react/project.mjs");
  const exe = await findBinary({ download });
  let measure = estimateText;
  let done = async () => {};
  if (exe) {
    const { startMeasurer } = await import("./react/measure.mjs");
    const m = startMeasurer(exe);
    measure = m.measure;
    done = m.close;
  } else warnings.add("text sizes are estimated: the engine is not downloaded yet (run a render once, or npm run build)");
  const comp = reactComposition(info, { props, measure, warn: (msg) => warnings.add(msg) });
  return { info, comp, mediaRoot, warnings, done };
}

async function compileWith(p, opts = {}) {
  const { compile, probeSize } = await import("./compose.mjs");
  try {
    return await compile(p.comp, { mediaRoot: p.mediaRoot, ...(opts.tolerant && { probe: async (src) => (existsSync(join(p.mediaRoot, src)) ? probeSize(join(p.mediaRoot, src)) : { w: 1920, h: 1080 }) }), range: opts.range });
  } finally {
    if (!opts.keepOpen) await p.done();
  }
}

function runEngine(layout, mediaRoot, out, name) {
  return findBinary().then((exe) => {
    const dir = join(tmpdir(), "fullgpu-render");
    mkdirSync(dir, { recursive: true });
    const layoutPath = join(dir, `${name}-${process.pid}.layout.json`);
    writeFileSync(layoutPath, JSON.stringify(layout));
    const r = spawnSync(exe, [layoutPath, mediaRoot, resolve(out)], { stdio: ["ignore", "pipe", "inherit"] });
    if (r.status !== 0) throw new Error(`The engine exited with code ${r.status}`);
    return JSON.parse(String(r.stdout || "{}"));
  });
}

const seconds = (ms) => Math.round(ms) / 1000;

async function render(args) {
  const t0 = performance.now();
  const p = await prepare(args, { download: true });
  const layout = await compileWith(p);
  const compileMs = performance.now() - t0;
  const stats = await runEngine(layout, p.mediaRoot, args.out, p.info.id);
  const { width, height, fps } = layout.scene;
  return {
    result: { out: args.out, composition: p.info.id, frames: layout.frames.length, width, height, fps, compileSeconds: seconds(compileMs), renderFps: Math.round(stats.fps ?? 0), totalSeconds: seconds(performance.now() - t0), warnings: [...p.warnings] },
    text: `${args.out}: ${layout.frames.length} frames, compiled in ${(compileMs / 1000).toFixed(1)} s, rendered at ${Math.round(stats.fps ?? 0)} fps (total ${((performance.now() - t0) / 1000).toFixed(1)} s)`,
  };
}

async function still(args) {
  const p = await prepare(args, { download: true });
  const total = p.info.durationInFrames;
  const bad = args.frames.find((f) => f >= total);
  if (bad != null) {
    await p.done();
    throw new Error(`frame ${bad} is outside the composition (0-${total - 1})`);
  }
  const files = [];
  const dir = join(tmpdir(), "fullgpu-render");
  try {
    for (const f of args.frames) {
      const layout = await compileWith(p, { range: [f, f + 1], keepOpen: true });
      layout.audio = null;
      const tmp = join(dir, `still-${process.pid}-${f}.mp4`);
      await runEngine(layout, p.mediaRoot, tmp, `${p.info.id}-still`);
      const png = stillPath(args.out, f, args.frames.length > 1);
      mkdirSync(dirname(resolve(png)), { recursive: true });
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-frames:v", "1", resolve(png)]);
      rmSync(tmp, { force: true });
      files.push(png);
    }
  } finally {
    await p.done();
  }
  return { result: { composition: p.info.id, files, frames: args.frames, warnings: [...p.warnings] }, text: files.join("\n") };
}

async function compositions(args) {
  const { comps } = await loadEntry(args.entry);
  const list = comps.map(({ id, width, height, fps, durationInFrames }) => ({ id, width, height, fps, durationInFrames }));
  return { result: { compositions: list }, text: list.map((c) => `${c.id}  ${c.width}x${c.height}  ${c.fps} fps  ${c.durationInFrames} frames`).join("\n") };
}

async function check(args) {
  const p = await prepare(args, { download: false });
  const layout = await compileWith(p, { tolerant: true });
  const r = checkLayout(layout, { exists: existsSync, mediaRoot: p.mediaRoot });
  const warnings = [...p.warnings];
  const lines = [
    `${p.info.id}: ${layout.frames.length} frames, ${layout.scene.width}x${layout.scene.height} at ${layout.scene.fps} fps, up to ${r.maxDraws} draws per frame`,
    ...r.errors.map((e) => `error: ${e}`),
    ...warnings.map((w) => `warning: ${w}`),
    r.errors.length ? "Not renderable: fix the errors above." : warnings.length ? "Renderable, with the warnings above (those effects are skipped)." : "Renderable, nothing unsupported found.",
  ];
  return { ok: r.errors.length === 0, result: { composition: p.info.id, frames: layout.frames.length, maxDraws: r.maxDraws, missing: r.missing, errors: r.errors, warnings }, text: lines.join("\n") };
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
  const add = (ok, label, fix, optional = false) => checks.push({ ok, label, fix, optional });
  const node = Number(process.versions.node.split(".")[0]);
  add(node >= 22, `Node ${process.versions.node}`, "Node 22 or newer is required");
  const gpu = run("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]);
  add(!!gpu, gpu ? `NVIDIA GPU: ${gpu.trim().split("\n")[0]}` : "No NVIDIA GPU found", "Install an NVIDIA driver (nvidia-smi must work)");
  const enc = run("ffmpeg", ["-hide_banner", "-encoders"]);
  const hw = run("ffmpeg", ["-hide_banner", "-hwaccels"]);
  const ff = enc && hw ? inspectFfmpeg(enc, hw) : null;
  add(!!ff, ff ? "ffmpeg found" : "ffmpeg not found", "Install ffmpeg and put it on the PATH");
  add(!!ff?.nvenc, "ffmpeg has h264_nvenc", "Use an ffmpeg build with NVENC (e.g. gyan.dev full on Windows)");
  add(!!ff?.cuda, "ffmpeg has CUDA decoding", "Use an ffmpeg build with CUDA hwaccel");
  const bin = await findBinary({ download: false });
  add(!!bin, bin ? `Engine: ${bin}` : "Engine not downloaded yet", "It downloads on the first render (or build it: npm run build)", true);
  const ok = checks.every((c) => c.ok || c.optional);
  const text = checks.map((c) => `${c.ok ? "ok  " : c.optional ? "note" : "fail"}  ${c.label}${c.ok ? "" : `\n      ${c.fix}`}`).join("\n");
  return { ok, result: { checks }, text };
}

const HANDLERS = { render, still, compositions, check, doctor };

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (argv.includes("--json")) console.log(JSON.stringify({ ok: false, command: argv[0], error: e.message }));
    else console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.command === "help") return console.log(USAGE);
  if (args.command === "version") return console.log(version());
  try {
    const { ok = true, result, text } = await HANDLERS[args.command](args);
    if (args.json) console.log(JSON.stringify({ ok, command: args.command, ...result }));
    else {
      for (const w of args.command === "check" ? [] : result.warnings ?? []) console.error(`warning: ${w}`);
      console.log(text);
    }
    if (!ok) process.exit(1);
  } catch (e) {
    if (args.json) console.log(JSON.stringify({ ok: false, command: args.command, error: e.message }));
    else console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

const cliArg = process.argv[1] ? resolve(process.argv[1]) : "";
if (cliArg === fileURLToPath(import.meta.url) || /[\\/]fullgpu(\.cmd|\.ps1)?$/.test(cliArg)) main();
