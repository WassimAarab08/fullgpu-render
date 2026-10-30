// Cliente del modo medición del motor (`fullgpu-render --measure`): un proceso abierto durante la compilación que
// responde, en orden, una línea JSON por texto. Así el layout mide con las mismas fuentes que luego pintan.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function startMeasurer(exe) {
  const child = spawn(exe, ["--measure"], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  let failure = null;
  createInterface({ input: child.stdout }).on("line", (line) => waiting.shift()?.resolve(JSON.parse(line)));
  const fail = (err) => {
    failure = err;
    for (const w of waiting.splice(0)) w.reject(err);
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`the text measurer exited (code ${code})`)));

  const one = (spec) =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      waiting.push({ resolve, reject });
      child.stdin.write(JSON.stringify(spec) + "\n");
    }).then((r) => {
      if (r.error) throw new Error(`measuring "${spec.text.slice(0, 30)}": ${r.error}`);
      return r;
    });

  return {
    measure: (specs) => Promise.all(specs.map(one)),
    close: () =>
      new Promise((resolve) => {
        child.removeAllListeners("exit");
        child.on("exit", resolve);
        child.stdin.end();
      }),
  };
}
