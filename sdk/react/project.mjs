// Proyectos React/Remotion: empaqueta el punto de entrada (TSX, JSX, TS o JS) con esbuild, con `react` y `remotion`
// apuntando a los módulos propios, y convierte cada composición en una composición del SDK cuyo render calcula el
// layout de cada fotograma.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composition } from "../compose.mjs";
import { createElement, renderFrame, getCompositions, setRoot } from "./runtime.mjs";
import { layoutFrame } from "./layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIMS = {
  react: "react.mjs",
  "react/jsx-runtime": "jsx-runtime.mjs",
  "react/jsx-dev-runtime": "jsx-runtime.mjs",
  remotion: "remotion.mjs",
  "@remotion/media": "media.mjs",
};

// Los sustitutos quedan fuera del bundle (como URL file://) para que el proyecto y la CLI compartan la misma instancia
// del runtime: registerRoot() dentro del bundle es el que lee getCompositions() aquí.
const shims = {
  name: "fullgpu-react",
  setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|remotion|@remotion\/media)$/ }, (a) => ({
      path: pathToFileURL(join(HERE, SHIMS[a.path])).href,
      external: true,
    }));
    b.onResolve({ filter: /^(@remotion\/|react-dom)/ }, (a) => ({ errors: [{ text: `${a.path} is not supported yet by fullgpu-render (supported: react, remotion, @remotion/media)` }] }));
  },
};

/** Empaqueta y ejecuta el punto de entrada; devuelve las composiciones que registra. */
export async function loadProject(entry) {
  const dir = join(tmpdir(), "fullgpu-render");
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, `bundle-${process.pid}-${Date.now()}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [shims],
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  setRoot(null);
  await import(pathToFileURL(outfile).href);
  return getCompositions();
}

/** Composición del SDK a partir de una composición React: cada fotograma se evalúa y pasa por el layout. */
export function reactComposition(info, { props = {}, measure, warn = () => {} }) {
  const { width, height, fps, durationInFrames } = info;
  const all = { ...info.defaultProps, ...props };
  return composition({ width, height, fps, durationInFrames, background: "#000000" }, async ({ frame }) => {
    const host = renderFrame(createElement(info.component, all), { ...info, frame, props: all });
    return layoutFrame(host, { width, height, fps, measure, warn });
  });
}
