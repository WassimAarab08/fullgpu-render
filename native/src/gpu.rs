//! Compositor wgpu: sube NV12 decodificado por NVDEC, compone con shaders/compose.wgsl (el mismo shader que
//! usa el navegador), convierte a NV12 en la GPU y lo lee de vuelta para NVENC con un anillo de buffers.

use crate::ffmpeg::{padded_row, strip_rows};
use crate::layout::{hex_color, Draw};
use crate::text::TextImage;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const COMPOSE: &str = include_str!("../../shaders/compose.wgsl");
const VIDEO_NV12: &str = include_str!("../../shaders/video_nv12.wgsl");
const RGB_TO_NV12: &str = include_str!("../../shaders/rgb_to_nv12.wgsl");
const SLOT: u64 = 256;
const MAX_DRAWS: u64 = 64;
pub const RING: usize = 3;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct DrawUniform {
    quad: [f32; 4],
    rect: [f32; 4],
    color: [f32; 4],
    params: [f32; 4],
    canvas: [f32; 4],
}

struct SourceTex {
    w: u32,
    h: u32,
    full_range: bool,
    y: wgpu::Texture,
    uv: wgpu::Texture,
}

struct Readback {
    buf: wgpu::Buffer,
    ready: Arc<AtomicBool>,
    submission: Option<wgpu::SubmissionIndex>,
}

pub struct Compositor {
    pub adapter: wgpu::AdapterInfo,
    device: wgpu::Device,
    queue: wgpu::Queue,
    w: u32,
    h: u32,
    background: [f32; 4],
    shape: wgpu::RenderPipeline,
    image: wgpu::RenderPipeline,
    video: wgpu::RenderPipeline,
    to_y: wgpu::RenderPipeline,
    to_uv: wgpu::RenderPipeline,
    ubuf: wgpu::Buffer,
    sampler: wgpu::Sampler,
    canvas: wgpu::Texture,
    out_y: wgpu::Texture,
    out_uv: wgpu::Texture,
    sources: HashMap<String, SourceTex>,
    texts: HashMap<String, (u32, u32, wgpu::TextureView)>,
    ring: Vec<Readback>,
}

fn pipeline(device: &wgpu::Device, module: &wgpu::ShaderModule, vs: &str, fs: &str, format: wgpu::TextureFormat, blend: bool) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(fs),
        layout: None,
        vertex: wgpu::VertexState { module, entry_point: Some(vs), compilation_options: Default::default(), buffers: &[] },
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fs),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: blend.then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn texture(device: &wgpu::Device, w: u32, h: u32, format: wgpu::TextureFormat, usage: wgpu::TextureUsages) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

impl Compositor {
    pub fn new(w: u32, h: u32, background: &str) -> anyhow::Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))?;
        let info = adapter.get_info();
        let (device, queue) = pollster::block_on(adapter.request_device(&Default::default()))?;
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let compose = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compose"),
            source: wgpu::ShaderSource::Wgsl(format!("{COMPOSE}\n{VIDEO_NV12}").into()),
        });
        let convert = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("rgb_to_nv12"),
            source: wgpu::ShaderSource::Wgsl(RGB_TO_NV12.into()),
        });
        use wgpu::TextureFormat as F;
        use wgpu::TextureUsages as U;
        let s = Self {
            shape: pipeline(&device, &compose, "vs", "fs_shape", F::Rgba8Unorm, true),
            image: pipeline(&device, &compose, "vs", "fs_image", F::Rgba8Unorm, true),
            video: pipeline(&device, &compose, "vs", "fs_video", F::Rgba8Unorm, true),
            to_y: pipeline(&device, &convert, "vs_full", "fs_y", F::R8Unorm, false),
            to_uv: pipeline(&device, &convert, "vs_full", "fs_uv", F::Rg8Unorm, false),
            ubuf: device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: SLOT * MAX_DRAWS,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            sampler: device.create_sampler(&wgpu::SamplerDescriptor {
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            canvas: texture(&device, w, h, F::Rgba8Unorm, U::RENDER_ATTACHMENT | U::TEXTURE_BINDING),
            out_y: texture(&device, w, h, F::R8Unorm, U::RENDER_ATTACHMENT | U::COPY_SRC),
            out_uv: texture(&device, w / 2, h / 2, F::Rg8Unorm, U::RENDER_ATTACHMENT | U::COPY_SRC),
            ring: (0..RING)
                .map(|_| Readback {
                    buf: device.create_buffer(&wgpu::BufferDescriptor {
                        label: None,
                        size: (padded_row(w) * h + padded_row(w) * h / 2) as u64,
                        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    }),
                    ready: Arc::new(AtomicBool::new(false)),
                    submission: None,
                })
                .collect(),
            sources: HashMap::new(),
            texts: HashMap::new(),
            adapter: info,
            background: hex_color(background),
            device,
            queue,
            w,
            h,
        };
        if let Some(e) = pollster::block_on(scope.pop()) {
            anyhow::bail!("shaders inválidos: {e}");
        }
        Ok(s)
    }

    pub fn add_source(&mut self, name: &str, w: u32, h: u32, full_range: bool) {
        use wgpu::TextureFormat as F;
        let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST;
        let y = texture(&self.device, w, h, F::R8Unorm, usage);
        let uv = texture(&self.device, w / 2, h / 2, F::Rg8Unorm, usage);
        self.sources.insert(name.into(), SourceTex { w, h, full_range, y, uv });
    }

    pub fn remove_source(&mut self, name: &str) {
        self.sources.remove(name);
    }

    pub fn add_text(&mut self, id: &str, img: &TextImage) {
        let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST;
        let tex = texture(&self.device, img.w, img.h, wgpu::TextureFormat::Rgba8Unorm, usage);
        self.write(&tex, &img.rgba, img.w * 4, img.w, img.h);
        self.texts.insert(id.into(), (img.w, img.h, tex.create_view(&Default::default())));
    }

    fn write(&self, tex: &wgpu::Texture, data: &[u8], bytes_per_row: u32, w: u32, h: u32) {
        self.queue.write_texture(
            tex.as_image_copy(),
            data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row), rows_per_image: None },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
    }

    /// Sube un fotograma NV12 (plano Y y plano UV entrelazado) de una fuente.
    pub fn upload(&self, name: &str, nv12: &[u8]) {
        let s = &self.sources[name];
        let y_len = (s.w * s.h) as usize;
        self.write(&s.y, &nv12[..y_len], s.w, s.w, s.h);
        self.write(&s.uv, &nv12[y_len..], s.w, s.w / 2, s.h / 2);
    }

    fn bind(&self, pipe: &wgpu::RenderPipeline, slot: u64, extra: &[(u32, wgpu::BindingResource)]) -> wgpu::BindGroup {
        let mut entries = vec![wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                buffer: &self.ubuf,
                offset: slot * SLOT,
                size: wgpu::BufferSize::new(std::mem::size_of::<DrawUniform>() as u64),
            }),
        }];
        entries.extend(extra.iter().map(|(binding, r)| wgpu::BindGroupEntry { binding: *binding, resource: r.clone() }));
        self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipe.get_bind_group_layout(0), entries: &entries })
    }

    /// Compone un fotograma en el hueco `slot` del anillo y encola su lectura.
    pub fn render(&mut self, draws: &[Draw], slot: usize) {
        let canvas = [self.w as f32, self.h as f32, 0.0, 0.0];
        let mut uniforms = Vec::with_capacity(draws.len());
        let mut groups = Vec::with_capacity(draws.len());
        let views: HashMap<&str, (wgpu::TextureView, wgpu::TextureView)> = self
            .sources
            .iter()
            .map(|(k, s)| (k.as_str(), (s.y.create_view(&Default::default()), s.uv.create_view(&Default::default()))))
            .collect();
        let samp = wgpu::BindingResource::Sampler(&self.sampler);
        for d in draws {
            match d {
                Draw::Shape { quad, rect, radius, softness, color, opacity } => {
                    let i = uniforms.len() as u64;
                    uniforms.push(DrawUniform { quad: *quad, rect: *rect, color: *color, params: [*radius, *softness, *opacity, 0.0], canvas });
                    groups.push((&self.shape, self.bind(&self.shape, i, &[])));
                }
                Draw::Video { source, quad, rect, radius, softness, opacity } => {
                    let i = uniforms.len() as u64;
                    let (y, uv) = &views[source.as_str()];
                    let full = if self.sources[source].full_range { 1.0 } else { 0.0 };
                    uniforms.push(DrawUniform { quad: *quad, rect: *rect, color: [0.0; 4], params: [*radius, *softness, *opacity, full], canvas });
                    let extra = [(1, samp.clone()), (4, wgpu::BindingResource::TextureView(y)), (5, wgpu::BindingResource::TextureView(uv))];
                    groups.push((&self.video, self.bind(&self.video, i, &extra)));
                }
                Draw::Text { id, cx, cy, opacity, bg, anchor_bottom } => {
                    let (w, h, view) = &self.texts[id];
                    let (w, h) = (*w as f32, *h as f32);
                    let pad_y = bg.as_ref().map_or(0.0, |b| b.pad_y);
                    // anchor_bottom: `cy` es el borde inferior (de la píldora si la hay), no el centro.
                    let ty = if *anchor_bottom { cy - pad_y - h / 2.0 } else { *cy };
                    let quad = [cx - w / 2.0, ty - h / 2.0, w, h];
                    if let Some(b) = bg {
                        let i = uniforms.len() as u64;
                        let pill = [quad[0] - b.pad_x, quad[1] - b.pad_y, w + 2.0 * b.pad_x, h + 2.0 * b.pad_y];
                        uniforms.push(DrawUniform { quad: pill, rect: pill, color: b.color, params: [b.radius, 1.0, *opacity, 0.0], canvas });
                        groups.push((&self.shape, self.bind(&self.shape, i, &[])));
                    }
                    let i = uniforms.len() as u64;
                    uniforms.push(DrawUniform { quad, rect: quad, color: [0.0; 4], params: [0.0, 1.0, *opacity, 0.0], canvas });
                    groups.push((&self.image, self.bind(&self.image, i, &[(1, samp.clone()), (2, wgpu::BindingResource::TextureView(view))])));
                }
            }
        }
        assert!(uniforms.len() as u64 <= MAX_DRAWS, "demasiadas primitivas en un fotograma: {}", uniforms.len());
        let mut padded = vec![0u8; uniforms.len() * SLOT as usize];
        for (i, u) in uniforms.iter().enumerate() {
            let b = bytemuck::bytes_of(u);
            padded[i * SLOT as usize..i * SLOT as usize + b.len()].copy_from_slice(b);
        }
        self.queue.write_buffer(&self.ubuf, 0, &padded);

        let mut enc = self.device.create_command_encoder(&Default::default());
        let canvas_view = self.canvas.create_view(&Default::default());
        let [r, g, b, a] = self.background.map(|v| v as f64);
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compose"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &canvas_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }), store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            });
            for (pipe, group) in &groups {
                pass.set_pipeline(pipe);
                pass.set_bind_group(0, group, &[]);
                pass.draw(0..6, 0..1);
            }
        }
        let canvas_group = |pipe: &wgpu::RenderPipeline| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &pipe.get_bind_group_layout(0),
                entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&canvas_view) }],
            })
        };
        for (pipe, target) in [(&self.to_y, &self.out_y), (&self.to_uv, &self.out_uv)] {
            let view = target.create_view(&Default::default());
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("nv12"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            });
            pass.set_pipeline(pipe);
            pass.set_bind_group(0, &canvas_group(pipe), &[]);
            pass.draw(0..3, 0..1);
        }
        let rb = &self.ring[slot];
        let row = padded_row(self.w);
        for (tex, offset, h) in [(&self.out_y, 0u64, self.h), (&self.out_uv, (row * self.h) as u64, self.h / 2)] {
            enc.copy_texture_to_buffer(
                tex.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &rb.buf,
                    layout: wgpu::TexelCopyBufferLayout { offset, bytes_per_row: Some(row), rows_per_image: None },
                },
                wgpu::Extent3d { width: tex.width(), height: h, depth_or_array_layers: 1 },
            );
        }
        let submission = self.queue.submit([enc.finish()]);
        let ready = rb.ready.clone();
        ready.store(false, Ordering::Release);
        rb.buf.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            r.expect("map_async");
            ready.store(true, Ordering::Release);
        });
        self.ring[slot].submission = Some(submission);
    }

    /// Espera la lectura del hueco `slot` y devuelve el NV12 compacto (sin relleno de fila).
    pub fn read(&mut self, slot: usize) -> anyhow::Result<Vec<u8>> {
        let rb = &mut self.ring[slot];
        let idx = rb.submission.take().expect("hueco sin render");
        while !rb.ready.load(Ordering::Acquire) {
            self.device.poll(wgpu::PollType::Wait { submission_index: Some(idx.clone()), timeout: None })?;
        }
        let row = padded_row(self.w) as usize;
        let (w, h) = (self.w as usize, self.h as usize);
        let mut out = Vec::with_capacity(w * h * 3 / 2);
        {
            let data = rb.buf.slice(..).get_mapped_range()?;
            strip_rows(&data, w, row, h, &mut out);
            strip_rows(&data[row * h..], w, row, h / 2, &mut out);
        }
        rb.buf.unmap();
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "necesita una GPU NVIDIA"]
    fn usa_la_nvidia_y_los_shaders_validan() {
        let c = Compositor::new(64, 32, "#F4F1EC").unwrap();
        assert_eq!(c.adapter.vendor, 0x10DE, "adaptador: {:?}", c.adapter);
    }

    #[test]
    #[ignore = "necesita una GPU NVIDIA"]
    fn compone_y_devuelve_nv12_con_la_luma_esperada() {
        let mut c = Compositor::new(64, 32, "#F4F1EC").unwrap();
        let black = Draw::Shape {
            quad: [0.0, 0.0, 16.0, 16.0],
            rect: [0.0, 0.0, 16.0, 16.0],
            radius: 0.0,
            softness: 1.0,
            color: [0.0, 0.0, 0.0, 1.0],
            opacity: 1.0,
        };
        c.render(&[black], 0);
        let nv12 = c.read(0).unwrap();
        assert_eq!(nv12.len(), 64 * 32 * 3 / 2);
        let y = |x: usize, yy: usize| nv12[yy * 64 + x] as i32;
        assert!((y(40, 20) - 223).abs() <= 1, "fondo Y={}", y(40, 20));
        assert!((y(4, 4) - 16).abs() <= 1, "negro Y={}", y(4, 4));
        let uv = &nv12[64 * 32..];
        assert!((uv[2 * 2] as i32 - 128).abs() <= 1, "negro sin croma");
    }

    #[test]
    #[ignore = "necesita una GPU NVIDIA"]
    fn dibuja_la_pildora_del_texto_anclada_abajo() {
        let mut c = Compositor::new(64, 32, "#F4F1EC").unwrap();
        c.add_text("t", &TextImage { w: 20, h: 8, rgba: vec![0; 20 * 8 * 4] });
        let pill = Draw::Text {
            id: "t".into(),
            cx: 32.0,
            cy: 32.0,
            opacity: 1.0,
            bg: Some(crate::layout::TextBg { color: [0.0, 0.0, 0.0, 1.0], pad_x: 4.0, pad_y: 4.0, radius: 0.0 }),
            anchor_bottom: true,
        };
        c.render(&[pill], 0);
        let nv12 = c.read(0).unwrap();
        let y = |x: usize, yy: usize| nv12[yy * 64 + x] as i32;
        assert!((y(32, 26) - 16).abs() <= 1, "dentro de la píldora Y={}", y(32, 26));
        assert!((y(32, 10) - 223).abs() <= 1, "encima de la píldora Y={}", y(32, 10));
    }
}
