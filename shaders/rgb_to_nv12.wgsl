// Rust/wgpu: pasa el lienzo RGBA compuesto a NV12 (BT.709, rango limitado) en la GPU,
// así solo se leen 1,5 bytes por píxel en vez de 4 y NVENC recibe su formato nativo.
@group(0) @binding(0) var src: texture_2d<f32>;

struct V { @builtin(position) pos: vec4f };

@vertex
fn vs_full(@builtin(vertex_index) i: u32) -> V {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: V;
  o.pos = vec4f(p[i], 0.0, 1.0);
  return o;
}

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn rgb(p: vec2i) -> vec3f {
  return textureLoad(src, p, 0).rgb;
}

@fragment
fn fs_y(v: V) -> @location(0) vec4f {
  let y = (16.0 + 219.0 * dot(rgb(vec2i(v.pos.xy)), LUMA)) / 255.0;
  return vec4f(y, 0.0, 0.0, 1.0);
}

@fragment
fn fs_uv(v: V) -> @location(0) vec4f {
  let p = vec2i(v.pos.xy) * 2;
  let c = (rgb(p) + rgb(p + vec2i(1, 0)) + rgb(p + vec2i(0, 1)) + rgb(p + vec2i(1, 1))) * 0.25;
  let y = dot(c, LUMA);
  let uv = (vec2f(128.0) + 224.0 * vec2f((c.b - y) / 1.8556, (c.r - y) / 1.5748)) / 255.0;
  return vec4f(uv, 0.0, 1.0);
}
