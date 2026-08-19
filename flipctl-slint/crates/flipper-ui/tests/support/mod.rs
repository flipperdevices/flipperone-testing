//! Golden-image support.
//!
//! A golden is an 8-bit greyscale PNG at panel resolution: exactly the bytes the
//! panel would receive, so a diff is a real visual regression and not a
//! colour-space artefact. Regenerate with `FLIPPER_UI_BLESS=1 cargo test`.

use std::path::{Path, PathBuf};


use flipper_ui::Surface;

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

fn raw(surface: &Surface) -> Vec<u8> {
    surface.pixels().iter().map(|p| p.0).collect()
}

fn write_png(path: &Path, w: u16, h: u16, data: &[u8]) {
    let file = std::fs::File::create(path).expect("create png");
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), u32::from(w), u32::from(h));
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .expect("png header")
        .write_image_data(data)
        .expect("png data");
}

fn read_png(path: &Path) -> (u16, u16, Vec<u8>) {
    let file = std::fs::File::open(path).expect("open golden");
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let mut reader = decoder.read_info().expect("png info");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("png frame");
    assert_eq!(info.color_type, png::ColorType::Grayscale, "golden must be grey");
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
    buf.truncate(info.buffer_size());
    (info.width as u16, info.height as u16, buf)
}

/// Compare `surface` against `tests/golden/<name>.png`.
///
/// On mismatch, writes `<name>.actual.png` next to the golden and reports the
/// first differing pixel plus the total, so the failure says where to look
/// rather than just that something moved.
pub fn assert_golden(name: &str, surface: &Surface) {
    let dir = golden_dir();
    std::fs::create_dir_all(&dir).expect("golden dir");
    let golden = dir.join(format!("{name}.png"));
    let actual = raw(surface);

    if std::env::var_os("FLIPPER_UI_BLESS").is_some() || !golden.exists() {
        write_png(&golden, surface.width(), surface.height(), &actual);
        if std::env::var_os("FLIPPER_UI_BLESS").is_none() {
            panic!("golden {name}.png did not exist and has been written; review it, then commit it");
        }
        return;
    }

    let (w, h, expected) = read_png(&golden);
    assert_eq!(
        (w, h),
        (surface.width(), surface.height()),
        "golden {name}.png is {w}x{h}, surface is {}x{}",
        surface.width(),
        surface.height()
    );

    if expected == actual {
        return;
    }

    write_png(
        &dir.join(format!("{name}.actual.png")),
        surface.width(),
        surface.height(),
        &actual,
    );

    let stride = usize::from(surface.width());
    let differing = expected.iter().zip(&actual).filter(|(a, b)| a != b).count();
    let (index, (want, got)) = expected
        .iter()
        .zip(&actual)
        .enumerate()
        .find(|(_, (a, b))| a != b)
        .map(|(i, (a, b))| (i, (*a, *b)))
        .expect("a difference exists");

    panic!(
        "golden {name}.png differs in {differing} of {} pixels; first at ({}, {}): \
         expected {want}, got {got}. Wrote {name}.actual.png",
        expected.len(),
        index % stride,
        index / stride,
    );
}

/// Render a surface as ASCII, for failures where an eyeball beats a PNG.
#[allow(dead_code)]
pub fn ascii(surface: &Surface) -> String {
    let mut s = String::new();
    for y in 0..surface.height() {
        for x in 0..surface.width() {
            s.push(match surface.get(x, y).0 {
                0..=63 => '#',
                64..=159 => '+',
                160..=239 => '.',
                _ => ' ',
            });
        }
        s.push('\n');
    }
    s
}
