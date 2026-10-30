// Navegador: el VideoFrame decodificado entra como texture_external (sin copia; el navegador convierte YUV->RGB).
@group(0) @binding(3) var vid: texture_external;

@fragment
fn fs_video(v: VOut) -> @location(0) vec4f {
  return screen_out(textureSampleBaseClampToEdge(vid, samp, video_uv(v.uv)).rgb, v.px);
}
