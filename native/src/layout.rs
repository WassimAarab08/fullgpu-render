//! Formato de entrada del motor (lo generan `scene/scene.mjs` y `timeline/compile.mjs`):
//! textos a rasterizar, flujos de vídeo (uno por plano), clips de voz y la lista de dibujo de cada fotograma.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct Layout {
    pub scene: Scene,
    pub streams: Vec<Stream>,
    pub audio: Option<Audio>,
    #[serde(default)]
    pub images: Vec<ImageSpec>,
    pub frames: Vec<Frame>,
}

/// Imagen (PNG, JPEG...) que se carga una vez como textura.
#[derive(Deserialize)]
pub struct ImageSpec {
    pub id: String,
    pub file: String,
}

/// Degradado lineal: de `color` a `to` en la dirección `dir` (vector unitario en px de pantalla).
#[derive(Deserialize)]
pub struct Gradient {
    pub to: [f32; 4],
    pub dir: [f32; 2],
}

fn full_uv() -> [f32; 4] {
    [0.0, 0.0, 1.0, 1.0]
}

fn one() -> f32 {
    1.0
}

#[derive(Deserialize)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub background: String,
    pub texts: Vec<TextSpec>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
pub struct TextSpec {
    #[serde(default)]
    pub id: String,
    pub text: String,
    pub font_size: f32,
    #[serde(default = "white")]
    pub color: String,
    pub weight: Option<u16>,
    pub max_width: Option<f32>,
    /// Familia tipográfica o lista CSS ("Inter, Segoe UI, sans-serif"); por defecto Segoe UI.
    pub font: Option<String>,
    /// Altura de línea en px (como CSS). Sin ella: 1,6 x tamaño, o 1,3 si se parte en líneas.
    pub line_height: Option<f32>,
    /// Alineación de las líneas partidas: "left", "center" (por defecto) o "right".
    pub text_align: Option<String>,
}

fn white() -> String {
    "#FFFFFF".into()
}

impl Default for TextSpec {
    fn default() -> Self {
        Self { id: String::new(), text: String::new(), font_size: 16.0, color: white(), weight: None, max_width: None, font: None, line_height: None, text_align: None }
    }
}

fn is_left<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(String::deserialize(d)? == "left")
}

/// Un tramo de una fuente: el fotograma `from + k` muestra el segundo `src_start_sec + k * rate / fps`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub id: String,
    pub file: String,
    pub src_start_sec: f64,
    pub rate: f64,
    pub from: usize,
    pub frames: usize,
    pub w: u32,
    pub h: u32,
}

impl Stream {
    /// Segundos de fuente que hay que decodificar (con un fotograma de margen).
    pub fn src_duration(&self, fps: u32) -> f64 {
        (self.frames + 1) as f64 * self.rate / fps as f64
    }
}

#[derive(Deserialize)]
pub struct Audio {
    pub file: String,
    pub clips: Vec<Clip>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub from_sec: f64,
    pub src_start_sec: f64,
    pub duration_sec: f64,
}

#[derive(Deserialize)]
pub struct Frame {
    pub draws: Vec<Draw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBg {
    pub color: [f32; 4],
    pub pad_x: f32,
    pub pad_y: f32,
    pub radius: f32,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum Draw {
    Shape {
        quad: [f32; 4],
        rect: [f32; 4],
        radius: f32,
        softness: f32,
        color: [f32; 4],
        opacity: f32,
        #[serde(default)]
        gradient: Option<Gradient>,
        /// Ancho del trazo en px: si es mayor que 0 solo se pinta el borde (como CSS border), no el relleno.
        #[serde(default)]
        stroke: f32,
        /// Rectángulo (x, y, w, h, con el mismo radio) que se recorta de la forma: una sombra no se ve debajo de su caja.
        #[serde(default)]
        cutout: Option<[f32; 4]>,
    },
    /// `uv`: parte de la fuente que se muestra (u0, v0, u1, v1), para recortar como `object-fit: cover`.
    Video {
        source: String,
        quad: [f32; 4],
        rect: [f32; 4],
        radius: f32,
        softness: f32,
        opacity: f32,
        #[serde(default = "full_uv")]
        uv: [f32; 4],
    },
    Text {
        id: String,
        cx: f32,
        cy: f32,
        opacity: f32,
        bg: Option<TextBg>,
        #[serde(default)]
        anchor_bottom: bool,
        #[serde(default = "one")]
        scale: f32,
        /// `align: "left"`: `cx` es el borde izquierdo en vez del centro.
        #[serde(default, rename = "align", deserialize_with = "is_left")]
        align_left: bool,
    },
    Image { id: String, quad: [f32; 4], radius: f32, opacity: f32 },
}

impl Layout {
    pub fn parse(json: &str) -> anyhow::Result<Self> {
        Ok(serde_json::from_str(json)?)
    }
}

/// "#RRGGBB" -> [r, g, b, 1] en 0..1.
pub fn hex_color(hex: &str) -> [f32; 4] {
    let c = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0) as f32 / 255.0;
    [c(1), c(3), c(5), 1.0]
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r##"{
      "scene": { "width": 1920, "height": 1080, "fps": 30, "background": "#F4F1EC",
        "texts": [ { "id": "t", "text": "مرحبا 你好", "fontSize": 36, "color": "#FFFFFF", "weight": 700, "maxWidth": 1440 } ] },
      "streams": [ { "id": "s5-0-phone", "file": "media/phone.mp4", "srcStartSec": 0, "rate": 0.3, "from": 2261, "frames": 571, "w": 364, "h": 788 } ],
      "audio": { "file": "audio/voz2.mp3", "clips": [ { "fromSec": 0.5, "srcStartSec": 0, "durationSec": 12.38 } ] },
      "frames": [
        { "draws": [
          { "kind": "shape", "censor": true, "quad": [0,0,10,10], "rect": [0,0,10,10], "radius": 4, "softness": 1, "color": [0,0,0,1], "opacity": 1 },
          { "kind": "video", "source": "s5-0-phone", "quad": [0,0,364,788], "rect": [0,0,364,788], "radius": 44, "softness": 1, "opacity": 1 },
          { "kind": "text", "id": "t", "cx": 960, "cy": 1046, "opacity": 0.5, "anchorBottom": true,
            "bg": { "color": [0.12,0.12,0.12,0.86], "padX": 30, "padY": 12, "radius": 18 } },
          { "kind": "text", "id": "t", "cx": 960, "cy": 70, "opacity": 1 } ] }
      ]
    }"##;

    #[test]
    fn parsea_textos_flujos_voz_y_primitivas() {
        let l = Layout::parse(SAMPLE).unwrap();
        assert_eq!((l.scene.width, l.scene.height, l.scene.fps), (1920, 1080, 30));
        assert_eq!(l.scene.texts[0].weight, Some(700));
        assert_eq!(l.scene.texts[0].max_width, Some(1440.0));
        assert_eq!(l.streams[0].from, 2261);
        assert_eq!(l.audio.as_ref().unwrap().clips[0].duration_sec, 12.38);
        let d = &l.frames[0].draws;
        assert!(matches!(&d[1], Draw::Video { source, .. } if source == "s5-0-phone"));
        assert!(matches!(&d[2], Draw::Text { anchor_bottom: true, bg: Some(b), .. } if b.pad_x == 30.0));
        assert!(matches!(&d[3], Draw::Text { anchor_bottom: false, bg: None, .. }));
    }

    #[test]
    fn duracion_de_fuente_con_margen() {
        let l = Layout::parse(SAMPLE).unwrap();
        assert!((l.streams[0].src_duration(30) - 572.0 * 0.3 / 30.0).abs() < 1e-9);
    }

    #[test]
    fn convierte_colores_hex() {
        assert_eq!(hex_color("#FF0000"), [1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn parsea_degradados_recorte_de_video_escala_de_texto_e_imagenes() {
        let l = Layout::parse(
            r##"{
          "scene": { "width": 64, "height": 32, "fps": 30, "background": "#000000", "texts": [] },
          "streams": [], "audio": null,
          "images": [ { "id": "logo", "file": "docs/logo.png" } ],
          "frames": [ { "draws": [
            { "kind": "shape", "quad": [0,0,8,8], "rect": [0,0,8,8], "radius": 0, "softness": 1, "color": [0,0,0,1], "opacity": 1,
              "gradient": { "to": [1,1,1,1], "dir": [1,0] } },
            { "kind": "shape", "quad": [0,0,8,8], "rect": [0,0,8,8], "radius": 0, "softness": 1, "color": [0,0,0,1], "opacity": 1, "stroke": 2, "cutout": [1,1,6,6] },
            { "kind": "video", "source": "v", "quad": [0,0,8,8], "rect": [0,0,8,8], "radius": 0, "softness": 1, "opacity": 1, "uv": [0.5,0,1,1] },
            { "kind": "video", "source": "v", "quad": [0,0,8,8], "rect": [0,0,8,8], "radius": 0, "softness": 1, "opacity": 1 },
            { "kind": "text", "id": "t", "cx": 1, "cy": 1, "opacity": 1, "scale": 1.5 },
            { "kind": "image", "id": "logo", "quad": [0,0,8,8], "radius": 2, "opacity": 1 }
          ] } ]
        }"##,
        )
        .unwrap();
        assert_eq!(l.images[0].file, "docs/logo.png");
        let d = &l.frames[0].draws;
        assert!(matches!(&d[0], Draw::Shape { gradient: Some(g), .. } if g.dir == [1.0, 0.0] && g.to[0] == 1.0));
        assert!(matches!(&d[0], Draw::Shape { stroke, .. } if *stroke == 0.0), "sin stroke es un relleno");
        assert!(matches!(&d[1], Draw::Shape { gradient: None, stroke, .. } if *stroke == 2.0));
        assert!(matches!(&d[1], Draw::Shape { cutout: Some(c), .. } if *c == [1.0, 1.0, 6.0, 6.0]));
        assert!(matches!(&d[0], Draw::Shape { cutout: None, .. }));
        assert!(matches!(&d[2], Draw::Video { uv, .. } if *uv == [0.5, 0.0, 1.0, 1.0]));
        assert!(matches!(&d[3], Draw::Video { uv, .. } if *uv == [0.0, 0.0, 1.0, 1.0]));
        assert!(matches!(&d[4], Draw::Text { scale, .. } if *scale == 1.5));
        assert!(matches!(&d[5], Draw::Image { id, radius, .. } if id == "logo" && *radius == 2.0));
        assert!(Layout::parse(SAMPLE).unwrap().images.is_empty(), "images es opcional");
    }

    #[test]
    fn parsea_fuente_y_alineacion_del_texto() {
        let l = Layout::parse(
            r##"{ "scene": { "width": 8, "height": 8, "fps": 30, "background": "#000000",
                  "texts": [ { "id": "c", "text": "x", "fontSize": 20, "color": "#FFFFFF", "font": "Consolas" } ] },
              "streams": [], "audio": null,
              "frames": [ { "draws": [ { "kind": "text", "id": "c", "cx": 1, "cy": 1, "opacity": 1, "align": "left" },
                                       { "kind": "text", "id": "c", "cx": 1, "cy": 1, "opacity": 1 } ] } ] }"##,
        )
        .unwrap();
        assert_eq!(l.scene.texts[0].font.as_deref(), Some("Consolas"));
        assert!(matches!(&l.frames[0].draws[0], Draw::Text { align_left: true, .. }));
        assert!(matches!(&l.frames[0].draws[1], Draw::Text { align_left: false, .. }));
    }
}
