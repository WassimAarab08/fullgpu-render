// Tests del verificador de MP4 de salida (sin ffprobe: solo la lógica de comprobación).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProbe } from "./verify.mjs";

const ok = { codec_name: "h264", width: 1920, height: 1080, nb_read_packets: "1800", r_frame_rate: "30/1" };

test("acepta un H.264 1920x1080 de 1800 fotogramas a 30 fps", () => {
  assert.deepEqual(checkProbe(ok), []);
});

test("informa de cada discrepancia", () => {
  const errs = checkProbe({ ...ok, width: 1280, nb_read_packets: "1799", r_frame_rate: "25/1" });
  assert.equal(errs.length, 3);
});
