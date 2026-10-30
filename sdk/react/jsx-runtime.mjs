// Sustituto de `react/jsx-runtime` y `react/jsx-dev-runtime` (JSX automático de esbuild/TypeScript).
import { jsx, Fragment } from "./runtime.mjs";

export { jsx, Fragment };
export const jsxs = jsx;
export const jsxDEV = (type, props, key) => jsx(type, props, key);
