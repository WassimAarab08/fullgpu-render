// Renderiza una composición del SDK con el motor nativo.
// Uso: node sdk/render.mjs <composición.mjs> <salida.mp4>   (las rutas de medios se resuelven desde la raíz del repo)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compile } from "./compose.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const [entry, out] = process.argv.slice(2);
if (!entry || !out) {
  console.error("Uso: node sdk/render.mjs <composición.mjs> <salida.mp4>");
  process.exit(2);
}
const t0 = performance.now();
const comp = (await import(pathToFileURL(resolve(entry)).href)).default;
const layout = await compile(comp, { mediaRoot: ROOT });
mkdirSync(resolve(ROOT, "out"), { recursive: true });
const layoutPath = resolve(ROOT, "out", `${basename(entry, ".mjs")}.layout.json`);
writeFileSync(layoutPath, JSON.stringify(layout));
const compileMs = performance.now() - t0;
const exe = ["release", "debug"].map((p) => resolve(ROOT, `native/target/${p}/fullgpu-render${process.platform === "win32" ? ".exe" : ""}`)).find(existsSync);
if (!exe) {
  console.error("Compila primero el motor: cargo build --release --manifest-path native/Cargo.toml");
  process.exit(1);
}
const r = spawnSync(exe, [layoutPath, ROOT, resolve(out)], { stdio: ["ignore", "pipe", "inherit"] });
const stats = JSON.parse(String(r.stdout || "{}") || "{}");
console.log(`${out}: ${layout.frames.length} fotogramas, compilado en ${(compileMs / 1000).toFixed(1)} s, render a ${Math.round(stats.fps ?? 0)} fps (total ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(r.status ?? 1);
