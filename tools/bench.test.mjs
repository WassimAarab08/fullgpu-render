// Tests de los resúmenes del benchmark (parseo de nvidia-smi y de los contadores de Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNvsmi, summarize, parseEngines, cpuPercent } from "./bench.mjs";

test("parsea líneas csv de nvidia-smi (gpu, enc, dec, mem, W) e ignora basura", () => {
  const rows = parseNvsmi("30, 12, 40, 900, 35.5\n[N/A], 1, 2, 3, 4\n\n50, 20, 60, 1000, 40\n");
  assert.deepEqual(rows, [
    { gpu: 30, enc: 12, dec: 40, memMiB: 900, watts: 35.5 },
    { gpu: 50, enc: 20, dec: 60, memMiB: 1000, watts: 40 },
  ]);
});

test("resume media y máximo por campo", () => {
  const s = summarize([{ a: 10, b: 1 }, { a: 30, b: 3 }]);
  assert.deepEqual(s, { a: { avg: 20, max: 30 }, b: { avg: 2, max: 3 } });
  assert.deepEqual(summarize([]), {});
});

test("agrupa los contadores GPU Engine por adaptador (luid) y tipo de motor", () => {
  const text = [
    "pid_1_luid_0x0_0xA_phys_0_eng_0_engtype_3D;12.5",
    "pid_2_luid_0x0_0xA_phys_0_eng_0_engtype_3D;7.5",
    "pid_2_luid_0x0_0xB_phys_0_eng_3_engtype_VideoEncode;40",
    "basura",
  ].join("\n");
  assert.deepEqual(parseEngines(text), { "0xA:3D": 20, "0xB:VideoEncode": 40 });
});

test("calcula el % de CPU entre dos lecturas de os.cpus()", () => {
  const t = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.equal(cpuPercent([t(100, 100), t(0, 200)], [t(150, 150), t(0, 300)]), 25);
});

test("los motores sin nombre (engtype_ vacío) no se pierden: se llaman engN", () => {
  assert.deepEqual(parseEngines("pid_9_luid_0x0_0xA_phys_0_eng_5_engtype_;33"), { "0xA:eng5": 33 });
});
