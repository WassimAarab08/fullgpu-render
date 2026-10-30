// Rust/wgpu: el vídeo llega en NV12 (plano Y R8 + plano UV RG8) y se convierte a RGB aquí (BT.709).
// d.params.w = 1 si la fuente es de rango completo (yuvj420p), 0 si es de rango limitado.
@group(0) @binding(4) var tex_y: texture_2d<f32>;
@group(0) @binding(5) var tex_uv: texture_2d<f32>;

@fragment
fn fs_video(v: VOut) -> @location(0) vec4f {
  let uv = video_uv(v.uv);
  var y = textureSample(tex_y, samp, uv).r;
  var c = textureSample(tex_uv, samp, uv).rg - vec2f(0.5);
  if (d.params.w < 0.5) {
    y = (y - 16.0 / 255.0) * (255.0 / 219.0);
    c = c * (255.0 / 224.0);
  }
  let rgb = vec3f(y + 1.5748 * c.y, y - 0.1873 * c.x - 0.4681 * c.y, y + 1.8556 * c.x);
  return screen_out(clamp(rgb, vec3f(0.0), vec3f(1.0)), v.px);
}
