// La referencia para modelos de lenguaje (docs/llms-full.txt) se genera desde el código: si alguien cambia la CLI, la
// API o el CSS soportado sin regenerarla, este test falla (arreglo: npm run llms).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildLlmsFull, LLMS_FULL, TEMPLATE } from "./llms.mjs";

test("docs/llms-full.txt está al día con el código (npm run llms)", async () => {
  assert.equal(readFileSync(LLMS_FULL, "utf8"), await buildLlmsFull());
});

test("la plantilla documenta cada función del SDK", async () => {
  const template = readFileSync(TEMPLATE, "utf8");
  for (const name of Object.keys(await import("../sdk/index.mjs"))) assert.ok(template.includes(`\`${name}`), `falta ${name}`);
});

test("la referencia incluye la CLI, la API de Remotion y el CSS que se acepta", async () => {
  const full = await buildLlmsFull();
  for (const s of ["fullgpu still", "fullgpu check", "--json", "useCurrentFrame", "AbsoluteFill", "boxShadow", "justifyContent"]) assert.ok(full.includes(s), s);
  assert.doesNotMatch(full, /{{[A-Z_]+}}/, "quedan marcadores sin rellenar");
});

test("llms.txt solo enlaza archivos que existen en el repositorio", () => {
  const txt = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
  assert.match(txt, /^# fullgpu-render\n\n> /);
  const links = [...txt.matchAll(/\]\(https:\/\/raw\.githubusercontent\.com\/WassimAarab08\/fullgpu-render\/main\/([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 5);
  for (const l of links) assert.ok(existsSync(new URL(`../${l}`, import.meta.url)), l);
});

test("plugin de Claude Code: mismo nombre en marketplace y plugin, versión del paquete y skill con descripción", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
  const market = read(".claude-plugin/marketplace.json");
  const plugin = read(".claude-plugin/plugin.json");
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, "./");
  assert.equal(plugin.version, read("package.json").version, "sube la versión del plugin con la del paquete");
  const skill = readFileSync(new URL("../skills/fullgpu-render/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const front = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front, "frontmatter en la primera línea con name y description");
  assert.equal(front[1], "fullgpu-render");
  assert.ok(front[2].length < 1536);
  assert.ok(skill.split("\n").length < 500);
});
