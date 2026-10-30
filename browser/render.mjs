// Variante (a): todo en el navegador y en la GPU.
// MP4 -> (mediabunny demux) -> VideoDecoder prefer-hardware -> VideoFrame -> importExternalTexture (sin copia)
// -> WebGPU compone (shaders/compose.wgsl) -> new VideoFrame(canvas) -> VideoEncoder prefer-hardware -> MP4.
import * as MB from "/node_modules/mediabunny/dist/bundles/mediabunny.mjs";
import { SCENE, frameAt, drawList } from "/scene/scene.mjs";

const q = new URLSearchParams(location.search);
const HW = q.get("hw") ?? "prefer-hardware";
const OUT = q.get("out") ?? "a.mp4";
const W = SCENE.width;
const H = SCENE.height;
const N = SCENE.fps * SCENE.durationSec;
const SLOT = 256; // alineación mínima de offsets de uniform buffer

const statusEl = document.getElementById("status");
const log = (m) => {
  statusEl.textContent += `\n${m}`;
  fetch("/log", { method: "POST", body: String(m) });
};

// Lee una fuente desde `offsetSec` y entrega, para cada instante, el último fotograma con timestamp <= t.
class SourceReader {
  constructor(spec) {
    this.spec = spec;
    this.queue = [];
    this.current = null;
    this.eof = false;
    this.waitMs = 0;
  }

  async init() {
    const input = new MB.Input({ source: new MB.UrlSource(`/media/${this.spec.file}`), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    this.config = { ...(await track.getDecoderConfig()), hardwareAcceleration: HW };
    this.support = await VideoDecoder.isConfigSupported(this.config);
    const sink = new MB.EncodedPacketSink(track);
    this.packets = sink.packets(await sink.getKeyPacket(this.spec.offsetSec));
    this.decoder = new VideoDecoder({
      output: (f) => {
        this.queue.push(f);
        this.wake?.();
      },
      error: (e) => {
        this.error = e;
        this.wake?.();
      },
    });
    this.decoder.ondequeue = () => this.wake?.();
    this.decoder.configure(this.config);
  }

  async feed() {
    while (!this.eof && this.queue.length < 4 && this.decoder.decodeQueueSize < 4) {
      const { value, done } = await this.packets.next();
      if (done) {
        this.eof = true;
        await this.decoder.flush();
      } else {
        this.decoder.decode(value.toEncodedVideoChunk());
      }
    }
  }

  async frameAt(t) {
    const limit = t * 1e6 + 1e6 / (2 * SCENE.fps);
    const t0 = performance.now();
    for (;;) {
      if (this.error) throw this.error;
      while (this.queue.length && this.queue[0].timestamp <= limit) {
        this.current?.close();
        this.current = this.queue.shift();
      }
      // Sabemos que `current` es el bueno cuando ya hay un fotograma posterior en cola (o se acabó el archivo).
      if (this.current && (this.queue.length || this.eof)) break;
      const woken = new Promise((r) => (this.wake = r));
      await this.feed();
      if (!(this.queue.length && this.queue[this.queue.length - 1].timestamp > limit)) await woken;
    }
    this.waitMs += performance.now() - t0;
    return this.current;
  }
}

async function rasterText(device, spec) {
  const font = `600 ${spec.fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  let c = new OffscreenCanvas(1, 1);
  let g = c.getContext("2d");
  g.font = font;
  const w = Math.ceil(g.measureText(spec.text).width) + 16;
  const h = Math.ceil(spec.fontSize * 1.6);
  c = new OffscreenCanvas(w, h);
  g = c.getContext("2d");
  g.font = font;
  g.fillStyle = spec.color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(spec.text, w / 2, h / 2);
  const tex = device.createTexture({
    size: [w, h],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: c }, { texture: tex, premultipliedAlpha: true }, [w, h]);
  return { view: tex.createView(), w, h };
}

async function main() {
  // ?delay=ms: espera antes de empezar (para abrir chrome://media-internals y ver qué codificador se usa).
  await new Promise((r) => setTimeout(r, Number(q.get("delay") ?? 0)));
  const tInit = performance.now();
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU no disponible");
  const gpu = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  log(`Adaptador WebGPU: ${JSON.stringify(gpu)}`);
  const device = await adapter.requestDevice();
  device.lost.then((i) => log(`Dispositivo perdido: ${i.message}`));

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const code = (await Promise.all(["compose", "video_external"].map((n) => fetch(`/shaders/${n}.wgsl`).then((r) => r.text())))).join("\n");
  const module = device.createShaderModule({ code });
  const blend = { srcFactor: "one", dstFactor: "one-minus-src-alpha" };
  const pipe = (fs) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: fs, targets: [{ format, blend: { color: blend, alpha: blend } }] },
    });
  const pipes = { shape: pipe("fs_shape"), text: pipe("fs_image"), video: pipe("fs_video") };
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const MAX_DRAWS = 16;
  const ubuf = device.createBuffer({ size: SLOT * MAX_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const texts = Object.fromEntries(await Promise.all(SCENE.texts.map(async (t) => [t.id, await rasterText(device, t)])));

  const readers = Object.fromEntries(Object.entries(SCENE.sources).map(([k, s]) => [k, new SourceReader(s)]));
  await Promise.all(Object.values(readers).map((r) => r.init()));
  for (const [k, r] of Object.entries(readers)) log(`Decoder ${k}: ${r.config.codec} soportado=${r.support.supported} (${HW})`);

  const encConfig = {
    codec: "avc1.640028", width: W, height: H, bitrate: 8_000_000, framerate: SCENE.fps,
    hardwareAcceleration: HW, latencyMode: "quality", avc: { format: "avc" },
  };
  const encSupport = await VideoEncoder.isConfigSupported(encConfig);
  log(`Encoder: soportado=${encSupport.supported} (${HW})`);
  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
  const vsrc = new MB.EncodedVideoPacketSource("avc");
  output.addVideoTrack(vsrc, { frameRate: SCENE.fps });
  await output.start();
  let muxing = Promise.resolve();
  let encError;
  let wakeEnc;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (muxing = muxing.then(() => vsrc.add(MB.EncodedPacket.fromEncodedChunk(chunk), meta))),
    error: (e) => (encError = e),
  });
  encoder.ondequeue = () => wakeEnc?.();
  encoder.configure(encConfig);

  const bg = [1, 3, 5].map((i) => parseInt(SCENE.background.slice(i, i + 2), 16) / 255);
  const uniforms = new Float32Array((SLOT / 4) * MAX_DRAWS);
  const initMs = performance.now() - tInit;
  log(`Inicialización: ${initMs.toFixed(0)} ms. Renderizando ${N} fotogramas…`);

  const t0 = performance.now();
  let encWaitMs = 0;
  for (let f = 0; f < N; f++) {
    const fr = frameAt(f);
    const draws = drawList(fr);
    const vframes = {};
    await Promise.all(fr.devices.map(async (d) => (vframes[d.source] = await readers[d.source].frameAt(d.sourceTime))));

    const cmd = device.createCommandEncoder();
    const pass = cmd.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: [...bg, 1], loadOp: "clear", storeOp: "store" }],
    });
    draws.forEach((d, i) => {
      const o = (i * SLOT) / 4;
      const quad = d.kind === "text" ? [d.cx - texts[d.id].w / 2, d.cy - texts[d.id].h / 2, texts[d.id].w, texts[d.id].h] : d.quad;
      const color2 = d.kind === "video" ? (d.uv ?? [0, 0, 1, 1]) : (d.gradient?.to ?? [0, 0, 0, 0]);
      const extra = d.gradient ? [...d.gradient.dir, 1, 0] : [0, 0, 0, 0];
      uniforms.set([...quad, ...(d.rect ?? quad), ...(d.color ?? [0, 0, 0, 0]), ...color2, d.radius ?? 0, d.softness ?? 1, d.opacity, 0, ...extra, W, H, 0, 0], o);
      const entries = [{ binding: 0, resource: { buffer: ubuf, offset: i * SLOT, size: 112 } }];
      if (d.kind !== "shape") entries.push({ binding: 1, resource: sampler });
      if (d.kind === "text") entries.push({ binding: 2, resource: texts[d.id].view });
      if (d.kind === "video") entries.push({ binding: 3, resource: device.importExternalTexture({ source: vframes[d.source] }) });
      const p = pipes[d.kind];
      pass.setPipeline(p);
      pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }));
      pass.draw(6);
    });
    pass.end();
    device.queue.writeBuffer(ubuf, 0, uniforms, 0, (draws.length * SLOT) / 4);
    device.queue.submit([cmd.finish()]);

    const out = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / SCENE.fps), duration: Math.round(1e6 / SCENE.fps) });
    const te = performance.now();
    while (encoder.encodeQueueSize > 4) await new Promise((r) => (wakeEnc = r));
    encWaitMs += performance.now() - te;
    if (encError) throw encError;
    encoder.encode(out, { keyFrame: f % (2 * SCENE.fps) === 0 });
    out.close();
    if (f % 150 === 0) log(`f=${f} ${((f + 1) / ((performance.now() - t0) / 1000)).toFixed(1)} fps`);
  }
  await encoder.flush();
  await muxing;
  const renderMs = performance.now() - t0;
  await output.finalize();
  for (const r of Object.values(readers)) r.current?.close();

  await fetch(`/out/${OUT}`, { method: "POST", body: output.target.buffer });
  const stats = {
    variant: "a-browser-webgpu-webcodecs",
    hw: HW,
    gpu,
    userAgent: navigator.userAgent,
    frames: N,
    initMs,
    renderMs,
    fps: N / (renderMs / 1000),
    decodeWaitMs: Object.fromEntries(Object.entries(readers).map(([k, r]) => [k, r.waitMs])),
    encodeWaitMs: encWaitMs,
    decoderSupported: Object.fromEntries(Object.entries(readers).map(([k, r]) => [k, r.support.supported])),
    encoderSupported: encSupport.supported,
    bytes: output.target.buffer.byteLength,
  };
  log(`Hecho: ${stats.fps.toFixed(1)} fps`);
  await fetch("/done", { method: "POST", body: JSON.stringify(stats) });
}

main().catch(async (e) => {
  log(`ERROR: ${e?.stack ?? e}`);
  await fetch("/done", { method: "POST", body: JSON.stringify({ error: String(e?.stack ?? e) }) });
});
