// Atajo de compatibilidad: `node sdk/render.mjs a.mjs out.mp4` equivale a `fullgpu render a.mjs out.mp4`.
import { main } from "./cli.mjs";

process.argv.splice(2, 0, "render");
await main();
