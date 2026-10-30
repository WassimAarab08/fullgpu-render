//! Motor nativo: NVDEC (ffmpeg, un proceso por plano) -> wgpu (shader compartido con el navegador) -> NVENC (ffmpeg),
//! con la voz mezclada y multiplexada en el mismo ffmpeg de salida.
//! Uso: fullgpu-render <layout.json> <carpeta raíz de medios> <salida.mp4>
//! Imprime en stdout un JSON con las métricas.

mod ffmpeg;
mod gpu;
mod layout;
mod text;

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, Receiver};
use std::thread;
use std::time::{Duration, Instant};

/// Fotogramas de antelación con que se lanza el ffmpeg de un plano (oculta su arranque, ~0,3 s).
const LOOKAHEAD: usize = 150;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(args.len() == 4, "usage: fullgpu-render <layout.json> <media root> <out.mp4>");
    let root = &args[2];
    let t_init = Instant::now();
    let layout = layout::Layout::parse(&std::fs::read_to_string(&args[1])?)?;
    let sc = &layout.scene;
    let n = layout.frames.len();

    let mut comp = gpu::Compositor::new(sc.width, sc.height, &sc.background)?;
    eprintln!("wgpu adapter: {} ({:?}, vendor {:#06x})", comp.adapter.name, comp.adapter.backend, comp.adapter.vendor);

    let mut texts = text::TextRasterizer::new();
    for t in &sc.texts {
        let img = texts.raster_with(&t.text, t.font_size, layout::hex_color(&t.color), t.weight.unwrap_or(600), t.max_width, t.font.as_deref());
        comp.add_text(&t.id, &img);
    }
    for img in &layout.images {
        comp.add_image(&img.id, &ffmpeg::load_image(&format!("{root}/{}", img.file))?);
    }
    let mut full_range: HashMap<&str, bool> = HashMap::new();
    for s in &layout.streams {
        if !full_range.contains_key(s.file.as_str()) {
            full_range.insert(&s.file, ffmpeg::probe_full_range(&format!("{root}/{}", s.file))?);
        }
    }

    // La voz se mezcla en paralelo en su propio ffmpeg; el vídeo va a NVENC y al final se unen sin recodificar.
    let video_out = if layout.audio.is_some() { format!("{}.video.mp4", args[3]) } else { args[3].clone() };
    let voice_out = format!("{}.voice.m4a", args[3]);
    let mixer = layout.audio.as_ref().map(|a| {
        let margs = ffmpeg::audio_mix_args(&format!("{root}/{}", a.file), &a.clips, &voice_out);
        thread::spawn(move || ffmpeg::run(&margs))
    });
    let eargs = ffmpeg::encode_args(sc.width, sc.height, sc.fps, &video_out);
    let (to_enc, enc_rx) = sync_channel::<Vec<u8>>(4);
    let writer = thread::spawn(move || -> anyhow::Result<()> {
        let mut enc = ffmpeg::Encoder::spawn(&eargs)?;
        for frame in enc_rx {
            enc.write(&frame)?;
        }
        enc.finish()
    });
    let init_ms = t_init.elapsed().as_secs_f64() * 1000.0;

    let mut order: Vec<usize> = (0..layout.streams.len()).collect();
    order.sort_by_key(|&i| layout.streams[i].from);
    let mut next = 0;
    let mut active: Vec<(usize, Receiver<Vec<u8>>)> = Vec::new();
    let mut max_active = 0;

    let t0 = Instant::now();
    let (mut decode_wait, mut encode_wait) = (Duration::ZERO, Duration::ZERO);
    let mut send = |frame: Vec<u8>| -> anyhow::Result<()> {
        let t = Instant::now();
        to_enc.send(frame)?;
        encode_wait += t.elapsed();
        Ok(())
    };
    for (f, fr) in layout.frames.iter().enumerate() {
        // Lanza los planos que empiezan pronto: un ffmpeg con NVDEC por plano, leído en su propio hilo.
        while next < order.len() && layout.streams[order[next]].from <= f + LOOKAHEAD {
            let s = &layout.streams[order[next]];
            comp.add_source(&s.id, s.w, s.h, full_range[s.file.as_str()]);
            let dargs = ffmpeg::decode_args(&format!("{root}/{}", s.file), s.src_start_sec, s.src_duration(sc.fps), s.rate, s.frames, s.w, s.h);
            let (w, h) = (s.w, s.h);
            let (tx, rx) = sync_channel(4);
            thread::spawn(move || {
                let mut dec = ffmpeg::Decoder::spawn(&dargs, w, h).expect("lanzar ffmpeg (NVDEC)");
                while let Ok(Some(frame)) = dec.next_frame() {
                    if tx.send(frame).is_err() {
                        break;
                    }
                }
            });
            active.push((order[next], rx));
            next += 1;
        }
        // Libera los planos terminados (cierra su ffmpeg al soltar el receptor).
        active.retain(|(i, _)| {
            let s = &layout.streams[*i];
            let alive = f < s.from + s.frames;
            if !alive {
                comp.remove_source(&s.id);
            }
            alive
        });
        max_active = max_active.max(active.len());
        for (i, rx) in &active {
            let s = &layout.streams[*i];
            if f < s.from {
                continue;
            }
            let t = Instant::now();
            // Si un plano da menos fotogramas de los previstos, se queda en el último.
            if let Ok(frame) = rx.recv() {
                comp.upload(&s.id, &frame);
            }
            decode_wait += t.elapsed();
        }
        let slot = f % gpu::RING;
        if f >= gpu::RING {
            send(comp.read(slot)?)?;
        }
        comp.render(&fr.draws, slot);
    }
    for i in n.saturating_sub(gpu::RING)..n {
        send(comp.read(i % gpu::RING)?)?;
    }
    drop(send);
    drop(to_enc);
    writer.join().expect("hilo NVENC")?;
    if let Some(mixer) = mixer {
        mixer.join().expect("hilo de voz")?;
        ffmpeg::run(&ffmpeg::mux_args(&video_out, &voice_out, &args[3]))?;
        std::fs::remove_file(&video_out)?;
        std::fs::remove_file(&voice_out)?;
    }
    let render_s = t0.elapsed().as_secs_f64();

    println!(
        "{}",
        serde_json::json!({
            "variant": "b-native-rust-wgpu-nvdec-nvenc",
            "adapter": { "name": comp.adapter.name, "backend": format!("{:?}", comp.adapter.backend), "vendor": comp.adapter.vendor },
            "frames": n,
            "streams": layout.streams.len(),
            "maxConcurrentStreams": max_active,
            "texts": sc.texts.len(),
            "audioClips": layout.audio.as_ref().map_or(0, |a| a.clips.len()),
            "initMs": init_ms,
            "renderMs": render_s * 1000.0,
            "fps": n as f64 / render_s,
            "decodeWaitMs": decode_wait.as_secs_f64() * 1000.0,
            "encodeWaitMs": encode_wait.as_secs_f64() * 1000.0,
        })
    );
    Ok(())
}
