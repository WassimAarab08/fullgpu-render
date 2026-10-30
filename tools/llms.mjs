// Genera docs/llms-full.txt (la referencia completa para modelos de lenguaje y agentes) a partir de la plantilla
// docs/llms/llms-full.template.md y de lo que exporta el código: uso de la CLI, API de remotion y react, y propiedades
// CSS que entiende el layout. Uso: npm run llms
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TEMPLATE = fileURLToPath(new URL("../docs/llms/llms-full.template.md", import.meta.url));
export const LLMS_FULL = fileURLToPath(new URL("../docs/llms-full.txt", import.meta.url));

const lf = (s) => s.replace(/\r\n/g, "\n");
const list = (names) => names.map((n) => `\`${n}\``).join(", ");

export async function buildLlmsFull() {
  const { USAGE } = await import("../sdk/cli.mjs");
  const remotion = Object.keys(await import("../sdk/react/remotion.mjs")).filter((n) => !["Internals", "VERSION"].includes(n)).sort();
  const react = Object.keys(await import("../sdk/react/react.mjs")).filter((n) => n !== "default").sort();
  const { SUPPORTED_STYLE } = await import("../sdk/react/layout.mjs");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const fill = {
    VERSION: version,
    CLI_USAGE: USAGE,
    REMOTION_EXPORTS: list(remotion),
    REACT_EXPORTS: list(react),
    CSS_PROPS: list([...SUPPORTED_STYLE].sort()),
  };
  return lf(readFileSync(TEMPLATE, "utf8")).replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in fill)) throw new Error(`unknown placeholder ${m}`);
    return fill[k];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(LLMS_FULL, await buildLlmsFull());
  console.log(`wrote ${LLMS_FULL}`);
}
