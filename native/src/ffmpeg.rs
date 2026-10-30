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

/// Codifica NV12 crudo de stdin con NVENC y, si hay voz, mezcla sus tramos (atrim + adelay + amix) y la multiplexa.
pub fn encode_args(w: u32, h: u32, fps: u32, out: &str, voice: Option<(&str, &[Clip])>) -> Vec<String> {
    let size = format!("{w}x{h}");
    let gop = (2 * fps).to_string();
    let fps = fps.to_string();
    let mut a: Vec<String> = ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "nv12", "-s", &size, "-r", &fps, "-i", "-"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some((file, clips)) = voice {
        let mut graph: Vec<String> = clips
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let delay = (c.from_sec * 1000.0).round() as i64;
                format!(
                    "[1:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,adelay={delay}:all=1[a{i}]",
                    c.src_start_sec, c.duration_sec
                )
            })
            .collect();
        let inputs: String = (0..clips.len()).map(|i| format!("[a{i}]")).collect();
        graph.push(format!("{inputs}amix=inputs={}:normalize=0[aout]", clips.len()));
        a.extend(["-i".into(), file.into(), "-filter_complex".into(), graph.join(";")]);
        a.extend(["-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k"].iter().map(|s| s.to_string()));
    }
    a.extend(
        [
            "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-b:v", "8M", "-g", &gop,
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            out,
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    a
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
        let a = encode_args(1920, 1080, 30, "out.mp4", None).join(" ");
        assert!(a.contains("-pix_fmt nv12 -s 1920x1080 -r 30 -i -"));
        assert!(a.contains("-c:v h264_nvenc"));
        assert!(a.contains("-g 60"));
        assert!(!a.contains("-map"));
        assert!(a.ends_with("out.mp4"));
    }

    #[test]
    fn mezcla_los_tramos_de_voz_en_su_sitio_y_los_multiplexa() {
        let clips = [
            Clip { from_sec: 0.5, src_start_sec: 0.0, duration_sec: 12.38 },
            Clip { from_sec: 13.8, src_start_sec: 12.5, duration_sec: 14.0 },
        ];
        let a = encode_args(1920, 1080, 30, "out.mp4", Some(("voz.mp3", &clips))).join(" ");
        assert!(a.contains("-i - -i voz.mp3"));
        assert!(a.contains("[1:a]atrim=start=0:duration=12.38,asetpts=PTS-STARTPTS,adelay=500:all=1[a0]"));
        assert!(a.contains("[1:a]atrim=start=12.5:duration=14,asetpts=PTS-STARTPTS,adelay=13800:all=1[a1]"));
        assert!(a.contains("[a0][a1]amix=inputs=2:normalize=0[aout]"));
        assert!(a.contains("-map 0:v -map [aout]"));
        assert!(a.contains("-c:a aac"));
    }
}
