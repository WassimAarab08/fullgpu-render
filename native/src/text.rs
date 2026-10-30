//! Rasterizado de texto con cosmic-text (shaping con rustybuzz, bidi y fallback de fuentes del sistema).
//! Devuelve RGBA premultiplicado del tamaño justo, como el canvas 2D de la variante navegador.

use cosmic_text::{Align, Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};

pub struct TextImage {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

pub struct TextRasterizer {
    fonts: FontSystem,
    cache: SwashCache,
}

impl TextRasterizer {
    pub fn new() -> Self {
        Self { fonts: FontSystem::new(), cache: SwashCache::new() }
    }

    /// `max_width`: si el texto no cabe, se parte en líneas centradas de ese ancho (subtítulos).
    pub fn raster(&mut self, text: &str, size: f32, color: [f32; 4], weight: u16, max_width: Option<f32>) -> TextImage {
        self.raster_with(text, size, color, weight, max_width, None)
    }

    /// Como `raster`, con otra familia tipográfica (si no existe, cosmic-text usa una de reserva).
    pub fn raster_with(&mut self, text: &str, size: f32, color: [f32; 4], weight: u16, max_width: Option<f32>, family: Option<&str>) -> TextImage {
        const PAD: i32 = 8;
        let line_h = (size * if max_width.is_some() { 1.3 } else { 1.6 }).ceil();
        let mut buf = Buffer::new(&mut self.fonts, Metrics::new(size, line_h));
        let attrs = Attrs::new().family(Family::Name(family.unwrap_or("Segoe UI"))).weight(Weight(weight));
        buf.set_size(&mut self.fonts, None, None);
        buf.set_text(&mut self.fonts, text, &attrs, Shaping::Advanced, None);
        buf.shape_until_scroll(&mut self.fonts, false);
        let natural = buf.layout_runs().map(|r| r.line_w).fold(0.0f32, f32::max);
        let box_w = match max_width {
            Some(m) if natural > m => {
                buf.set_size(&mut self.fonts, Some(m), None);
                buf.set_text(&mut self.fonts, text, &attrs, Shaping::Advanced, Some(Align::Center));
                buf.shape_until_scroll(&mut self.fonts, false);
                m
            }
            _ => natural,
        };
        let lines = buf.layout_runs().count().max(1) as u32;
        let (w, h) = (box_w.ceil() as u32 + 2 * PAD as u32, lines * line_h as u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        let c = |v: f32| (v * 255.0).round() as u8;
        let ink = Color::rgba(c(color[0]), c(color[1]), c(color[2]), c(color[3]));
        buf.draw(&mut self.fonts, &mut self.cache, ink, |x, y, gw, gh, col| {
            let a = col.a() as f32 / 255.0;
            if a == 0.0 {
                return;
            }
            for py in y.max(0)..(y + gh as i32).min(h as i32) {
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
}
