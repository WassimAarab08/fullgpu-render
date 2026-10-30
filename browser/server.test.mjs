// Tests del servidor local de la variante navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange, resolvePath } from "./server.mjs";

test("parsea rangos HTTP", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  assert.equal(parseRange("bytes=2000-", 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

test("/media/ apunta a la carpeta de medios y no deja salir de las carpetas", () => {
  assert.match(resolvePath("/media/phone.mp4"), /media[\\/]phone\.mp4$/);
  assert.match(resolvePath("/scene/scene.mjs"), /[\\/]scene[\\/]scene\.mjs$/);
  assert.match(resolvePath("/?hw=prefer-hardware&out=a.mp4"), /browser[\\/]index\.html$/);
  assert.equal(resolvePath("/media/../../secret"), null);
  assert.equal(resolvePath("/../outside/package.json"), null);
});
