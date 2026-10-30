// Compositor compartido por la variante navegador (WebGPU) y la variante Rust (wgpu).
// Cada primitiva de scene.mjs/drawList se dibuja como un quad; el recorte redondeado y la sombra salen de un SDF.
// Salida en alfa premultiplicado (blend one / one-minus-src-alpha).
// La lectura del vídeo (fs_video) va en otro archivo: video_external.wgsl (navegador) o video_nv12.wgsl (Rust).

struct Draw {
  quad: vec4f,   // área dibujada en px: x, y, w, h
  rect: vec4f,   // rectángulo redondeado en px: x, y, w, h
  color: vec4f,  // rgba sin premultiplicar
  color2: vec4f, // forma: color final del degradado; vídeo: parte de la fuente mostrada (u0, v0, u1, v1)
  params: vec4f, // radio, suavizado en px, opacidad, rango completo (1) o limitado (0) del vídeo
  extra: vec4f,  // forma: dirección del degradado (x, y) y 1 si hay degradado
  canvas: vec4f, // ancho, alto del lienzo
};

@group(0) @binding(0) var<uniform> d: Draw;
@group(0) @binding(1) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f,
  @location(1) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var corners = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let uv = corners[i];
  let px = d.quad.xy + uv * d.quad.zw;
  var o: VOut;
  o.pos = vec4f(px.x / d.canvas.x * 2.0 - 1.0, 1.0 - px.y / d.canvas.y * 2.0, 0.0, 1.0);
  o.px = px;
  o.uv = uv;
  return o;
}

fn sd_round_rect(p: vec2f, r: vec4f, radius: f32) -> f32 {
  let q = abs(p - (r.xy + r.zw * 0.5)) - r.zw * 0.5 + vec2f(radius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn coverage(px: vec2f) -> f32 {
  let s = max(d.params.y, 1.0);
  return 1.0 - smoothstep(-s * 0.5, s * 0.5, sd_round_rect(px, d.rect, d.params.x));
}

// Color de la forma: liso o degradado lineal a lo largo de d.extra.xy (de borde a borde del rectángulo).
fn fill(px: vec2f) -> vec4f {
  if (d.extra.z < 0.5) {
    return d.color;
  }
  let dir = d.extra.xy;
  let half = 0.5 * (abs(dir.x) * d.rect.z + abs(dir.y) * d.rect.w);
  let t = clamp(dot(px - (d.rect.xy + d.rect.zw * 0.5), dir) / max(half, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
  return mix(d.color, d.color2, t);
}

@fragment
fn fs_shape(v: VOut) -> @location(0) vec4f {
  let c = fill(v.px);
  let a = c.a * d.params.z * coverage(v.px);
  return vec4f(c.rgb * a, a);
}

@group(0) @binding(2) var img: texture_2d<f32>;

// Texto o imagen ya rasterizados (premultiplicados) en una textura que cubre el quad; d.params.x redondea esquinas.
@fragment
fn fs_image(v: VOut) -> @location(0) vec4f {
  return textureSample(img, samp, v.uv) * d.params.z * coverage(v.px);
}

// Coordenada de la fuente de vídeo dentro de la parte mostrada (d.color2), para recortar como object-fit: cover.
fn video_uv(uv: vec2f) -> vec2f {
  return mix(d.color2.xy, d.color2.zw, uv);
}

// Pantalla: color del vídeo recortado con el rectángulo redondeado.
fn screen_out(rgb: vec3f, px: vec2f) -> vec4f {
  let a = d.params.z * coverage(px);
  return vec4f(rgb * a, a);
}
