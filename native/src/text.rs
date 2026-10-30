//! Rasterizado de texto con cosmic-text (shaping con rustybuzz, bidi y fallback de fuentes del sistema).
//! Devuelve RGBA premultiplicado del tamaño justo, como el canvas 2D de la variante navegador.

use cosmic_text::{Align, Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};

use crate::layout::TextSpec;

pub struct TextImage {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

/// Tamaño de un texto para el layout: ancho de la línea más ancha, número de líneas y la altura de línea `normal` de
/// CSS para su fuente (ascendente + descendente + interlineado, como Chrome).
pub struct Measure {
    pub width: f32,
    pub lines: u32,
    pub normal_line_height: f32,
}

/// Margen horizontal del raster (los glifos pueden salirse un poco de su avance).
pub const PAD: i32 = 8;

/// Margen vertical cuando la altura de línea es explícita: con line-height pequeño los glifos sobresalen de la línea
/// (en CSS no se recortan). Es simétrico, así que el centro de la caja no cambia.
pub fn vpad(size: f32) -> u32 {
    (size / 2.0).ceil() as u32
}

pub struct TextRasterizer {
    fonts: FontSystem,
    cache: SwashCache,
}

enum Fam {
    Name(String),
    Serif,
    SansSerif,
    Monospace,
}

impl TextRasterizer {
    pub fn new() -> Self {
        Self { fonts: FontSystem::new(), cache: SwashCache::new() }
    }

    /// Peso que hay que pedir a cosmic-text para no salir de `family`: el exacto si existe; si no, el más cercano de esa
    /// familia (una fuente variable como Bahnschrift solo registra su cara por defecto). Sin esto, un peso inexistente
    /// hace que cosmic-text cambie de familia (Bahnschrift 600 -> Segoe UI Semibold).
    fn nearest_weight(&self, family: &str, wanted: u16) -> u16 {
        let weights: Vec<u16> = self
            .fonts
            .db()
            .faces()
            .filter(|f| f.families.iter().any(|(n, _)| n.eq_ignore_ascii_case(family)))
            .map(|f| f.weight.0)
            .collect();
        match weights.as_slice() {
            [] => wanted,
            w if w.contains(&wanted) => wanted,
            w => *w.iter().min_by_key(|x| (**x as i32 - wanted as i32).abs()).unwrap(),
        }
    }

    /// Primera familia instalada de una lista CSS; los genéricos (serif, sans-serif, monospace) los resuelve fontdb.
    fn resolve_family(&self, list: &str) -> Fam {
        let names: Vec<&str> = list.split(',').map(|n| n.trim().trim_matches(|c| c == '"' || c == '\'')).filter(|n| !n.is_empty()).collect();
        for n in &names {
            match n.to_ascii_lowercase().as_str() {
                "serif" => return Fam::Serif,
                "sans-serif" | "system-ui" => return Fam::SansSerif,
                "monospace" => return Fam::Monospace,
                _ => {}
            }
            if self.fonts.db().faces().any(|f| f.families.iter().any(|(fam, _)| fam.eq_ignore_ascii_case(n))) {
                return Fam::Name(n.to_string());
            }
        }
        Fam::Name(names.first().unwrap_or(&"Segoe UI").to_string())
    }

    /// Buffer con el texto colocado (ancho natural o partido en `max_width`, con la alineación pedida) y el ancho de su caja.
    fn layout(&mut self, spec: &TextSpec, line_h: f32) -> (Buffer, f32) {
        let fam = self.resolve_family(spec.font.as_deref().unwrap_or("Segoe UI"));
        let wanted = spec.weight.unwrap_or(600);
        let (family, weight) = match &fam {
            Fam::Name(n) => (Family::Name(n), self.nearest_weight(n, wanted)),
            Fam::Serif => (Family::Serif, wanted),
            Fam::SansSerif => (Family::SansSerif, wanted),
            Fam::Monospace => (Family::Monospace, wanted),
        };
        let attrs = Attrs::new().family(family).weight(Weight(weight));
        let align = match spec.text_align.as_deref() {
            Some("left") | Some("start") => Align::Left,
            Some("right") | Some("end") => Align::Right,
            _ => Align::Center,
        };
        let mut buf = Buffer::new(&mut self.fonts, Metrics::new(spec.font_size, line_h));
        buf.set_size(&mut self.fonts, None, None);
        buf.set_text(&mut self.fonts, &spec.text, &attrs, Shaping::Advanced, None);
        buf.shape_until_scroll(&mut self.fonts, false);
        let natural = buf.layout_runs().map(|r| r.line_w).fold(0.0f32, f32::max);
        match spec.max_width {
            Some(m) if natural > m => {
                buf.set_size(&mut self.fonts, Some(m), None);
                buf.set_text(&mut self.fonts, &spec.text, &attrs, Shaping::Advanced, Some(align));
                buf.shape_until_scroll(&mut self.fonts, false);
                (buf, m)
            }
            _ => (buf, natural),
        }
    }

    fn line_height(spec: &TextSpec) -> f32 {
        spec.line_height.unwrap_or_else(|| (spec.font_size * if spec.max_width.is_some() { 1.3 } else { 1.6 }).ceil())
    }

    pub fn measure(&mut self, spec: &TextSpec) -> Measure {
        let (buf, _) = self.layout(spec, Self::line_height(spec));
        let width = buf.layout_runs().map(|r| r.line_w).fold(0.0f32, f32::max);
        let lines = buf.layout_runs().count().max(1) as u32;
        let weight = Weight(spec.weight.unwrap_or(600));
        let first = buf.layout_runs().find_map(|r| r.glyphs.first().map(|g| g.font_id));
        let normal_line_height = first
            .and_then(|id| self.fonts.get_font(id, weight))
            .map(|f| {
                let m = f.metrics();
                (m.ascent - m.descent + m.leading) / f32::from(m.units_per_em) * spec.font_size
            })
            .unwrap_or(spec.font_size * 1.2);
        Measure { width, lines, normal_line_height }
    }

    pub fn raster(&mut self, text: &str, size: f32, color: [f32; 4], weight: u16, max_width: Option<f32>) -> TextImage {
        self.raster_with(text, size, color, weight, max_width, None)
    }

    /// Como `raster`, con otra familia tipográfica (si no existe, cosmic-text usa una de reserva).
    pub fn raster_with(&mut self, text: &str, size: f32, color: [f32; 4], weight: u16, max_width: Option<f32>, family: Option<&str>) -> TextImage {
        let spec = TextSpec { text: text.into(), font_size: size, weight: Some(weight), max_width, font: family.map(Into::into), ..Default::default() };
        self.paint(&spec, color)
    }

    /// Rasteriza un texto del layout con su color.
    pub fn raster_spec(&mut self, spec: &TextSpec) -> TextImage {
        self.paint(spec, crate::layout::hex_color(&spec.color))
    }

    fn paint(&mut self, spec: &TextSpec, color: [f32; 4]) -> TextImage {
        let line_h = Self::line_height(spec);
        let top = if spec.line_height.is_some() { vpad(spec.font_size) } else { 0 };
        let (buf, box_w) = self.layout(spec, line_h);
        let lines = buf.layout_runs().count().max(1) as u32;
        let (w, h) = (box_w.ceil() as u32 + 2 * PAD as u32, (lines as f32 * line_h).ceil() as u32 + 2 * top);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        let c = |v: f32| (v * 255.0).round() as u8;
        let ink = Color::rgba(c(color[0]), c(color[1]), c(color[2]), c(color[3]));
        let top = top as i32;
        buf.draw(&mut self.fonts, &mut self.cache, ink, |x, y, gw, gh, col| {
            let a = col.a() as f32 / 255.0;
            if a == 0.0 {
                return;
            }
            for py in (y + top).max(0)..(y + top + gh as i32).min(h as i32) {
                for px in (x + PAD).max(0)..(x + PAD + gw as i32).min(w as i32) {
                    let i = ((py as u32 * w + px as u32) * 4) as usize;
                    let src = [col.r(), col.g(), col.b()].map(|v| v as f32 * a);
                    for k in 0..3 {
                        rgba[i + k] = (src[k] + rgba[i + k] as f32 * (1.0 - a)).round() as u8;
                    }
                    rgba[i + 3] = (a * 255.0 + rgba[i + 3] as f32 * (1.0 - a)).round() as u8;
                }
            }
        });
        TextImage { w, h, rgba }
    }
}

/// Modo medición (`fullgpu-render --measure`): un TextSpec JSON por línea de entrada y una respuesta JSON por línea
/// de salida, en orden. El SDK lo mantiene abierto mientras calcula el layout de los componentes React.
pub fn serve_measure(t: &mut TextRasterizer, input: impl std::io::BufRead, mut out: impl std::io::Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<TextSpec>(&line) {
            Ok(spec) => {
                let m = t.measure(&spec);
                serde_json::json!({ "width": m.width, "lines": m.lines, "normalLineHeight": m.normal_line_height })
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }),
        };
        writeln!(out, "{reply}")?;
        out.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opaque_pixels(img: &TextImage) -> usize {
        img.rgba.chunks(4).filter(|p| p[3] > 200).count()
    }

    #[test]
    fn rasteriza_arabe_y_chino_con_glifos_reales() {
        let mut t = TextRasterizer::new();
        for s in ["الرقابة الأبوية", "家长控制"] {
            let img = t.raster(s, 64.0, [0.12, 0.12, 0.12, 1.0], 600, None);
            assert_eq!(img.rgba.len(), (img.w * img.h * 4) as usize);
            assert!(img.w > 4 * 64 - 64, "{s}: ancho {} demasiado pequeño", img.w);
            assert!(opaque_pixels(&img) > 2000, "{s}: casi sin tinta");
        }
    }

    #[test]
    fn la_salida_esta_premultiplicada() {
        let mut t = TextRasterizer::new();
        let img = t.raster("FullGPU Render", 64.0, [1.0, 0.5, 0.0, 1.0], 600, None);
        assert!(img.rgba.chunks(4).all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]));
        assert!(opaque_pixels(&img) > 1000);
    }

    #[test]
    fn parte_en_lineas_centradas_lo_que_no_cabe_en_el_ancho_maximo() {
        let mut t = TextRasterizer::new();
        let long = "Escribe el dominio, el usuario y la contraseña que has recibido y pulsa Iniciar sesión para continuar con la configuración";
        let one = t.raster(long, 36.0, [1.0; 4], 700, None);
        let wrapped = t.raster(long, 36.0, [1.0; 4], 700, Some(600.0));
        assert!(one.w > 1200, "sin límite va en una línea ({})", one.w);
        assert!(wrapped.w <= 600 + 16, "ancho {}", wrapped.w);
        assert!(wrapped.h >= 3 * (36.0f32 * 1.25) as u32, "alto {}", wrapped.h);
        let short = t.raster("Hola", 36.0, [1.0; 4], 700, Some(600.0));
        assert!(short.w < 200, "un texto corto no ocupa el ancho máximo ({})", short.w);
    }

    #[test]
    fn con_fuente_monoespaciada_todas_las_letras_ocupan_lo_mismo() {
        let mut t = TextRasterizer::new();
        let narrow = t.raster_with("iiiiiiii", 32.0, [1.0; 4], 400, None, Some("Consolas"));
        let wide = t.raster_with("MMMMMMMM", 32.0, [1.0; 4], 400, None, Some("Consolas"));
        assert!((narrow.w as i32 - wide.w as i32).abs() <= 2, "{} vs {}", narrow.w, wide.w);
        let prop_narrow = t.raster("iiiiiiii", 32.0, [1.0; 4], 400, None);
        let prop_wide = t.raster("MMMMMMMM", 32.0, [1.0; 4], 400, None);
        assert!(prop_wide.w > prop_narrow.w * 2, "Segoe UI es proporcional");
    }

    fn spec(text: &str, size: f32) -> TextSpec {
        TextSpec { text: text.into(), font_size: size, weight: Some(400), ..Default::default() }
    }

    fn ink_columns(img: &TextImage, rows: std::ops::Range<u32>) -> (u32, u32) {
        let mut cols = (u32::MAX, 0);
        for y in rows {
            for x in 0..img.w {
                if img.rgba[((y * img.w + x) * 4 + 3) as usize] > 128 {
                    cols = (cols.0.min(x), cols.1.max(x));
                }
            }
        }
        cols
    }

    #[test]
    fn serve_measure_responde_una_linea_json_por_texto() {
        let mut t = TextRasterizer::new();
        let input = "{\"text\":\"Hola\",\"fontSize\":40}
no es json
{\"text\":\"uno dos tres cuatro\",\"fontSize\":40,\"maxWidth\":120}
";
        let mut out = Vec::new();
        serve_measure(&mut t, input.as_bytes(), &mut out).unwrap();
        let lines: Vec<serde_json::Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0]["width"].as_f64().unwrap() > 40.0);
        assert_eq!(lines[0]["lines"], 1);
        assert!(lines[0]["normalLineHeight"].as_f64().unwrap() > 40.0);
        assert!(lines[1]["error"].is_string());
        assert!(lines[2]["lines"].as_u64().unwrap() >= 2);
    }

    #[test]
    fn measure_da_el_ancho_del_texto_sin_el_margen_del_raster() {
        let mut t = TextRasterizer::new();
        let s = TextSpec { line_height: Some(80.0), ..spec("FullGPU Render", 64.0) };
        let m = t.measure(&s);
        let img = t.raster_spec(&s);
        assert_eq!(m.lines, 1);
        assert!((m.width - (img.w - 2 * PAD as u32) as f32).abs() <= 1.0, "{} vs {}", m.width, img.w);
    }

    #[test]
    fn measure_parte_en_lineas_y_devuelve_la_linea_mas_ancha() {
        let mut t = TextRasterizer::new();
        let long = "Escribe el dominio, el usuario y la contraseña que has recibido y pulsa Iniciar sesión para continuar";
        let m = t.measure(&TextSpec { max_width: Some(600.0), ..spec(long, 36.0) });
        assert!(m.lines >= 3, "líneas {}", m.lines);
        assert!(m.width <= 600.0 && m.width > 400.0, "ancho {}", m.width);
    }

    #[test]
    fn la_altura_de_linea_normal_sale_de_las_metricas_de_la_fuente() {
        // Segoe UI: (ascender 2210 + descender 514) / 2048 = 1,33 (lo que usa Chrome con line-height: normal).
        let mut t = TextRasterizer::new();
        let m = t.measure(&spec("Hola", 100.0));
        assert!((m.normal_line_height - 133.0).abs() < 3.0, "{}", m.normal_line_height);
    }

    #[test]
    fn con_altura_de_linea_explicita_el_raster_mide_lineas_por_altura_mas_un_margen_vertical() {
        let mut t = TextRasterizer::new();
        let s = TextSpec { max_width: Some(120.0), line_height: Some(50.0), ..spec("una dos tres cuatro", 36.0) };
        let lines = t.measure(&s).lines;
        assert!(lines >= 2);
        assert_eq!(t.raster_spec(&s).h, lines * 50 + 2 * vpad(36.0));
    }

    #[test]
    fn text_align_alinea_las_lineas_partidas() {
        let mut t = TextRasterizer::new();
        // Ancho justo para la primera palabra: "ii" baja a una segunda línea, corta.
        let wide = t.measure(&spec("MMMMMMMM", 32.0)).width;
        let base = TextSpec { max_width: Some(wide + 10.0), line_height: Some(40.0), ..spec("MMMMMMMM ii", 32.0) };
        assert_eq!(t.measure(&base).lines, 2);
        let left = t.raster_spec(&TextSpec { text_align: Some("left".into()), ..base.clone() });
        let center = t.raster_spec(&base);
        let right = t.raster_spec(&TextSpec { text_align: Some("right".into()), ..base.clone() });
        let last = |img: &TextImage| ink_columns(img, img.h - vpad(32.0) - 40..img.h - vpad(32.0));
        assert!(last(&left).0 < PAD as u32 + 4, "izquierda {:?}", last(&left));
        assert!(last(&center).0 > (wide / 2.0) as u32 - 20, "centro {:?}", last(&center));
        assert!(last(&right).1 > left.w - PAD as u32 - 6, "derecha {:?}", last(&right));
    }

    #[test]
    fn la_familia_es_una_lista_css_y_usa_la_primera_instalada_o_un_generico() {
        let mut t = TextRasterizer::new();
        for family in ["\"No Such Font\", Consolas, monospace", "monospace"] {
            let w = |t: &mut TextRasterizer, s: &str| t.measure(&TextSpec { font: Some(family.into()), ..spec(s, 32.0) }).width;
            let (narrow, wide) = (w(&mut t, "iiiiiiii"), w(&mut t, "MMMMMMMM"));
            assert!((narrow - wide).abs() <= 2.0, "{family}: {narrow} vs {wide}");
        }
    }

    #[test]
    fn un_peso_que_la_familia_no_tiene_usa_el_mas_cercano_de_esa_familia() {
        // Consolas no tiene peso 600: debe usar Consolas (monoespaciada), no saltar a Segoe UI Semibold.
        let mut t = TextRasterizer::new();
        let narrow = t.raster_with("iiiiiiii", 32.0, [1.0; 4], 600, None, Some("Consolas"));
        let wide = t.raster_with("MMMMMMMM", 32.0, [1.0; 4], 600, None, Some("Consolas"));
        assert!((narrow.w as i32 - wide.w as i32).abs() <= 2, "{} vs {}", narrow.w, wide.w);
    }
}
