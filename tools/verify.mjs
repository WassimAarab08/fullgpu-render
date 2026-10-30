// Comprueba que un MP4 de salida cumple el contrato del benchmark y extrae fotogramas de control.
// Uso: node tools/verify.mjs out/a.mp4 [--frames]   (con --frames guarda PNG a 10 s y 45 s junto al MP4)
import { execFileSync } from "node:child_process";
import { SCENE } from "../scene/scene.mjs";

export function checkProbe(s) {
  const errs = [];
  const frames = SCENE.fps * SCENE.durationSec;
  if (s.codec_name !== "h264") errs.push(`códec ${s.codec_name} != h264`);
  if (s.width !== SCENE.width || s.height !== SCENE.height) errs.push(`tamaño ${s.width}x${s.height}`);
  if (Number(s.nb_read_packets) !== frames) errs.push(`fotogramas ${s.nb_read_packets} != ${frames}`);
  if (s.r_frame_rate !== `${SCENE.fps}/1`) errs.push(`fps ${s.r_frame_rate}`);
  return errs;
}

function probe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_packets",
    "-show_entries", "stream=codec_name,width,height,nb_read_packets,r_frame_rate",
    "-of", "json", file,
  ]);
  return JSON.parse(out).streams[0];
}

if (process.argv[1]?.endsWith("verify.mjs")) {
  const file = process.argv[2];
  const errs = checkProbe(probe(file));
  if (process.argv.includes("--frames")) {
    for (const t of [10, 45]) {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", file.replace(/\.mp4$/, `-${t}s.png`)]);
    }
  }
  console.log(errs.length ? `FALLO ${file}: ${errs.join("; ")}` : `OK ${file}`);
  process.exit(errs.length ? 1 : 0);
}
