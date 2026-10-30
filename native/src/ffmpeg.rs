//! ffmpeg como E/S de vídeo por hardware: NVDEC (+ scale_cuda) para leer y NVENC para escribir.
//! Los fotogramas cruzan por tuberías en NV12 crudo; la composición la hace wgpu.

use crate::layout::Clip;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub fn nv12_size(w: u32, h: u32) -> usize {
    (w * h * 3 / 2) as usize
}

/// wgpu exige que cada fila copiada a un buffer ocupe un múltiplo de 256 bytes.
pub fn padded_row(bytes: u32) -> u32 {
    bytes.div_ceil(256) * 256
}

/// Quita el relleno de fila de una lectura de GPU y lo añade a `dst`.
pub fn strip_rows(src: &[u8], row: usize, padded: usize, rows: usize, dst: &mut Vec<u8>) {
    for r in 0..rows {
        dst.extend_from_slice(&src[r * padded..r * padded + row]);
    }
}

/// Decodifica un plano: `frames` fotogramas a 30 fps desde `start` a velocidad `rate` (setpts + fps), escalado
/// en la GPU con scale_cuda y bajado a NV12 crudo por stdout.
pub fn decode_args(path: &str, start: f64, src_dur: f64, rate: f64, frames: usize, w: u32, h: u32) -> Vec<String> {
    let vf = format!(
        "setpts=(PTS-STARTPTS)/{rate},fps=30,scale_cuda=w={w}:h={h}:interp_algo=bicubic:format=nv12,hwdownload,format=nv12"
    );
    [
        "-v", "error", "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
        "-ss", &start.to_string(), "-t", &src_dur.to_string(), "-i", path,
        "-vf", &vf, "-frames:v", &frames.to_string(), "-f", "rawvideo", "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// Codifica NV12 crudo de stdin con NVENC (solo vídeo; la voz va en `audio_mix_args` y se une con `mux_args`).
pub fn encode_args(w: u32, h: u32, fps: u32, out: &str) -> Vec<String> {
    let size = format!("{w}x{h}");
    let gop = (2 * fps).to_string();
    let fps = fps.to_string();
    strings(&[
        "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "nv12", "-s", &size, "-r", &fps, "-i", "-",
        "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-b:v", "8M", "-g", &gop,
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        out,
    ])
}

/// Mezcla los tramos de voz (atrim + adelay + amix) en un proceso aparte, en paralelo al render.
/// Meterlo en el mismo ffmpeg que NVENC frenaba la tubería de vídeo (~28 s en un vídeo de 4 min).
pub fn audio_mix_args(file: &str, clips: &[Clip], out: &str) -> Vec<String> {
    let mut graph: Vec<String> = clips
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let delay = (c.from_sec * 1000.0).round() as i64;
            format!("[0:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,adelay={delay}:all=1[a{i}]", c.src_start_sec, c.duration_sec)
        })
        .collect();
    let inputs: String = (0..clips.len()).map(|i| format!("[a{i}]")).collect();
    graph.push(format!("{inputs}amix=inputs={}:normalize=0[aout]", clips.len()));
    let graph = graph.join(";");
    strings(&["-v", "error", "-y", "-i", file, "-filter_complex", &graph, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", out])
}

/// Une vídeo y voz sin recodificar.
pub fn mux_args(video: &str, audio: &str, out: &str) -> Vec<String> {
    strings(&["-v", "error", "-y", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", out])
}

/// Ejecuta ffmpeg hasta el final y falla si no termina bien.
pub fn run(args: &[String]) -> anyhow::Result<()> {
    let status = Command::new("ffmpeg").args(args).status()?;
    anyhow::ensure!(status.success(), "ffmpeg terminó con {status}");
    Ok(())
}

/// Carga una imagen (PNG, JPEG, WebP...) con ffmpeg como RGBA premultiplicado.
pub fn load_image(path: &str) -> anyhow::Result<crate::text::TextImage> {
    let probe = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path])
        .output()?;
    let dims = String::from_utf8_lossy(&probe.stdout);
    let (w, h) = dims.trim().split_once('x').ok_or_else(|| anyhow::anyhow!("no se pudo leer el tamaño de {path}"))?;
    let (w, h): (u32, u32) = (w.parse()?, h.parse()?);
    let out = Command::new("ffmpeg").args(["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]).output()?;
    anyhow::ensure!(out.status.success() && out.stdout.len() == (w * h * 4) as usize, "ffmpeg no pudo decodificar {path}");
    let mut rgba = out.stdout;
    for p in rgba.chunks_mut(4) {
        let a = p[3] as u32;
        for c in &mut p[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
    Ok(crate::text::TextImage { w, h, rgba })
}

/// true si la fuente es de rango completo (color_range=pc, p. ej. yuvj420p).
pub fn probe_full_range(path: &str) -> anyhow::Result<bool> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_range,pix_fmt", "-of", "csv=p=0", path])
        .output()?;
    anyhow::ensure!(out.status.success(), "ffprobe falló con {path}");
    let s = String::from_utf8_lossy(&out.stdout);
    Ok(s.contains("pc") || s.contains("yuvj"))
}

pub struct Decoder {
    child: Child,
    out: ChildStdout,
    frame_bytes: usize,
}

impl Decoder {
    pub fn spawn(args: &[String], w: u32, h: u32) -> anyhow::Result<Self> {
        let mut child = Command::new("ffmpeg").args(args).stdout(Stdio::piped()).spawn()?;
        let out = child.stdout.take().unwrap();
        Ok(Self { child, out, frame_bytes: nv12_size(w, h) })
    }

    /// Siguiente fotograma NV12, o None al final del archivo.
    pub fn next_frame(&mut self) -> anyhow::Result<Option<Vec<u8>>> {
        let mut buf = vec![0u8; self.frame_bytes];
        let mut got = 0;
        while got < buf.len() {
            let n = self.out.read(&mut buf[got..])?;
            if n == 0 {
                return Ok(None);
            }
            got += n;
        }
        Ok(Some(buf))
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

pub struct Encoder {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Encoder {
    pub fn spawn(args: &[String]) -> anyhow::Result<Self> {
        let mut child = Command::new("ffmpeg").args(args).stdin(Stdio::piped()).spawn()?;
        let stdin = child.stdin.take();
        Ok(Self { child, stdin })
    }

    pub fn write(&mut self, nv12: &[u8]) -> anyhow::Result<()> {
        Ok(self.stdin.as_mut().unwrap().write_all(nv12)?)
    }

    pub fn finish(mut self) -> anyhow::Result<()> {
        drop(self.stdin.take());
        let status = self.child.wait()?;
        anyhow::ensure!(status.success(), "ffmpeg (NVENC) terminó con {status}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "necesita ffprobe y media/ (tools/make-sample-media.sh)"]
    fn detecta_el_rango_de_color_de_las_entradas() {
        let media = concat!(env!("CARGO_MANIFEST_DIR"), "/../media/");
        assert!(probe_full_range(&format!("{media}tablet.mp4")).unwrap(), "tablet es yuvj420p (pc)");
        assert!(!probe_full_range(&format!("{media}phone.mp4")).unwrap(), "phone es tv");
    }

    #[test]
    fn tamanos_nv12_y_relleno_de_fila() {
        assert_eq!(nv12_size(1920, 1080), 3_110_400);
        assert_eq!(padded_row(1920), 2048);
        assert_eq!(padded_row(2048), 2048);
    }

    #[test]
    fn quita_el_relleno_de_cada_fila() {
        let src = [1, 2, 0, 0, 3, 4, 0, 0];
        let mut dst = vec![9];
        strip_rows(&src, 2, 4, 2, &mut dst);
        assert_eq!(dst, [9, 1, 2, 3, 4]);
    }

    #[test]
    fn decodifica_un_plano_a_su_velocidad_y_escala_en_la_gpu_nvidia() {
        let a = decode_args("in.mp4", 2.0, 7.55, 1.3888, 162, 360, 796).join(" ");
        assert!(a.contains("-hwaccel cuda -hwaccel_output_format cuda"));
        assert!(a.contains("-ss 2 -t 7.55 -i in.mp4"));
        // lanczos de scale_cuda (ffmpeg 8.0.1) deja fantasmas en texto pequeño; bicubic queda como el escalado por CPU.
        assert!(a.contains("setpts=(PTS-STARTPTS)/1.3888,fps=30,scale_cuda=w=360:h=796:interp_algo=bicubic"));
        assert!(a.ends_with("-frames:v 162 -f rawvideo -"));
    }

    #[test]
    fn codifica_nv12_con_nvenc() {
        let a = encode_args(1920, 1080, 30, "out.mp4").join(" ");
        assert!(a.contains("-pix_fmt nv12 -s 1920x1080 -r 30 -i -"));
        assert!(a.contains("-c:v h264_nvenc"));
        assert!(a.contains("-g 60"));
        assert!(!a.contains("-map"));
        assert!(a.ends_with("out.mp4"));
    }

    #[test]
    fn mezcla_los_tramos_de_voz_en_un_proceso_aparte() {
        let clips = [
            Clip { from_sec: 0.5, src_start_sec: 0.0, duration_sec: 12.38 },
            Clip { from_sec: 13.8, src_start_sec: 12.5, duration_sec: 14.0 },
        ];
        let a = audio_mix_args("voz.mp3", &clips, "voz.m4a").join(" ");
        assert!(a.contains("-i voz.mp3"));
        assert!(a.contains("[0:a]atrim=start=0:duration=12.38,asetpts=PTS-STARTPTS,adelay=500:all=1[a0]"));
        assert!(a.contains("[0:a]atrim=start=12.5:duration=14,asetpts=PTS-STARTPTS,adelay=13800:all=1[a1]"));
        assert!(a.contains("[a0][a1]amix=inputs=2:normalize=0[aout]"));
        assert!(a.ends_with("-map [aout] -c:a aac -b:a 192k voz.m4a"));
    }

    #[test]
    fn multiplexa_sin_recodificar() {
        let a = mux_args("v.mp4", "voz.m4a", "out.mp4").join(" ");
        assert!(a.contains("-i v.mp4 -i voz.m4a"));
        assert!(a.ends_with("-map 0:v -map 1:a -c copy -movflags +faststart out.mp4"));
    }

    #[test]
    #[ignore = "necesita ffmpeg"]
    fn carga_una_imagen_como_rgba_premultiplicado() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/target/test-half-red.png");
        let ok = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=4x2,format=rgba", "-frames:v", "1", path])
            .status()
            .unwrap();
        assert!(ok.success());
        let img = load_image(path).unwrap();
        assert_eq!((img.w, img.h, img.rgba.len()), (4, 2, 32));
        let p = &img.rgba[..4];
        assert!((p[3] as i32 - 128).abs() <= 1, "alfa {}", p[3]);
        assert!((p[0] as i32 - p[3] as i32).abs() <= 1, "rojo premultiplicado {}", p[0]);
        assert_eq!((p[1], p[2]), (0, 0));
    }
}
