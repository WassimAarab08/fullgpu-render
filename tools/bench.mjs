// Ejecuta un comando de render y mide tiempo total, nvidia-smi y los contadores "GPU Engine" de Windows
// (estos últimos también ven la Intel UHD, que nvidia-smi no ve).
// Uso: [BENCH_ENGINES=0] node tools/bench.mjs <nombre> <fotogramas> -- <comando> [args...]
// Deja out/bench/<nombre>.json (resumen) y out/bench/<nombre>.log (salida del comando).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { cpus } from "node:os";

export function parseNvsmi(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.split(",").map((v) => Number(v.trim())))
    .filter((v) => v.length === 5 && v.every(Number.isFinite))
    .map(([gpu, enc, dec, memMiB, watts]) => ({ gpu, enc, dec, memMiB, watts }));
}

export function summarize(rows) {
  const out = {};
  for (const k of Object.keys(rows[0] ?? {})) {
    const vals = rows.map((r) => r[k] ?? 0);
    out[k] = { avg: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) };
  }
  return out;
}

// Un bloque de muestras "instancia;valor" -> { "<luid>:<tipo>": % } como el Administrador de tareas:
// suma por motor de todos los procesos y luego el máximo de los motores del mismo tipo.
export function parseEngines(text) {
  const perEngine = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /luid_0x[0-9a-f]+_(0x[0-9a-f]+)_phys_\d+_eng_(\d+)_engtype_([^;]*);([\d.,]+)$/i.exec(line);
    if (!m) continue;
    const key = `${m[1]}:${m[3] || `eng${m[2]}`}|${m[2]}`;
    perEngine[key] = (perEngine[key] ?? 0) + Number(m[4].replace(",", "."));
  }
  const out = {};
  for (const [key, v] of Object.entries(perEngine)) {
    const k = key.split("|")[0];
    out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}

// % de CPU total entre dos lecturas de os.cpus() (no depende del idioma de Windows, a diferencia de los contadores).
export function cpuPercent(prev, cur) {
  let busy = 0;
  let total = 0;
  cur.forEach((c, i) => {
    const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0);
    const dt = sum(c.times) - sum(prev[i].times);
    total += dt;
    busy += dt - (c.times.idle - prev[i].times.idle);
  });
  return total ? (100 * busy) / total : 0;
}

// La Intel es la que pinta la pantalla (motor "gdi render"); la NVIDIA tiene motores "security".
function labelAdapters(keys) {
  const labels = {};
  for (const k of keys) {
    const [luid, type] = k.split(":");
    if (/gdi render/i.test(type)) labels[luid] = "intel";
    if (/security/i.test(type) && !labels[luid]) labels[luid] = "nvidia";
  }
  return labels;
}

const ENGINE_SCRIPT = `
Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -Continuous -ErrorAction SilentlyContinue | ForEach-Object {
  $_.CounterSamples | ForEach-Object { "$($_.InstanceName);$($_.CookedValue)" }
  '---'
}`;

async function main() {
  const [name, framesArg, sep, cmd, ...args] = process.argv.slice(2);
  if (!name || sep !== "--" || !cmd) {
    console.error("Uso: node tools/bench.mjs <nombre> <fotogramas> -- <comando> [args...]");
    process.exit(2);
  }
  mkdirSync("out/bench", { recursive: true });
  let nv = "";
  let eng = "";
  const nvsmi = spawn("nvidia-smi", [
    "--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,memory.used,power.draw",
    "--format=csv,noheader,nounits", "-lms", "500",
  ]);
  nvsmi.stdout.on("data", (d) => (nv += d));
  // BENCH_ENGINES=0: sin contadores de Windows (cuestan CPU); solo nvidia-smi, para medir velocidad.
  const ps = process.env.BENCH_ENGINES === "0" ? null : spawn("powershell", ["-NoProfile", "-Command", ENGINE_SCRIPT]);
  ps?.stdout.on("data", (d) => (eng += d));

  const cpuSamples = [];
  let lastCpus = cpus();
  const cpuTimer = setInterval(() => {
    const now = cpus();
    cpuSamples.push({ cpu: cpuPercent(lastCpus, now) });
    lastCpus = now;
  }, 1000);

  const log = createWriteStream(`out/bench/${name}.log`);
  const t0 = performance.now();
  const child = spawn(cmd, args, { shell: /^(npx|npm)$/.test(cmd) });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.stdout.on("data", (d) => process.stdout.write(d));
  const code = await new Promise((r) => child.on("exit", r));
  const wallSec = (performance.now() - t0) / 1000;
  nvsmi.kill();
  ps?.kill();
  clearInterval(cpuTimer);

  const samples = eng.split("---").map((block) => ({ engines: parseEngines(block) })).filter((s) => Object.keys(s.engines).length);
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s.engines)))];
  const labels = labelAdapters(keys);
  const engines = {};
  for (const k of keys) {
    const [luid, type] = k.split(":");
    if (!type || !labels[luid]) continue;
    const vals = samples.map((s) => s.engines[k] ?? 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (Math.max(...vals) > 1) engines[`${labels[luid]}:${type}`] = { avg, max: Math.max(...vals) };
  }

  const frames = Number(framesArg);
  const result = {
    name,
    command: [cmd, ...args].join(" "),
    exitCode: code,
    wallSec,
    frames,
    fps: frames / wallSec,
    nvidiaSmi: summarize(parseNvsmi(nv)),
    cpu: summarize(cpuSamples).cpu,
    engineSamples: samples.length,
    engines,
  };
  writeFileSync(`out/bench/${name}.json`, JSON.stringify(result, null, 2));
  console.log(`\n[bench] ${name}: ${wallSec.toFixed(1)} s, ${result.fps.toFixed(1)} fps, salida ${code}`);
  process.exit(code ?? 1);
}

if (process.argv[1]?.endsWith("bench.mjs")) main();
