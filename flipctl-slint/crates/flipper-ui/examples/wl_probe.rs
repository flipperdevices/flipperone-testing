//! Host one app in its own compositor and capture it, without flipctl in the way.
//!
//! Usage: wl_probe "<command>" [frames]
//!
//! Writes each real frame's mean grey and a PGM of the last one, so the proof is a
//! picture rather than a claim. `FLIPCTL_CAPWAIT_MS` waits before each conversion,
//! which is how "the copy is not finished when it says it is" gets tested.

use std::time::{Duration, Instant};

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "sleep 60".into());
    let frames: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(20);

    let (w, h) = (
        u32::from(flipper_ui::PANEL_W),
        u32::from(flipper_ui::PANEL_H),
    );
    println!("hosting {command:?} on a {w}x{h} output");

    let began = Instant::now();
    let mut app = flipper_ui::wl::Session::launch(&command, w, h)?;
    println!("up in {}ms", began.elapsed().as_millis());
    // Frames are read by the session's own thread, so ask for a stream and take
    // whatever has arrived.
    app.stream(true);

    let mut got = 0;
    let loop_began = Instant::now();
    for i in 0..frames {
        if i % 2 == 1 {
            app.key(106, true);
            app.key(106, false);
        }
        let waited = Instant::now();
        let mut frame = None;
        while waited.elapsed() < Duration::from_millis(4000) {
            frame = app.fresh();
            if frame.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        match frame {
            Some(grey) => {
                got += 1;
                let mut pgm = format!("P5\n{w} {h}\n255\n").into_bytes();
                pgm.extend_from_slice(&grey);
                std::fs::write("/tmp/wl_probe.pgm", pgm)?;
                let mean: u32 = grey.iter().map(|&p| u32::from(p)).sum::<u32>() / grey.len() as u32;
                let ink = grey.iter().filter(|&&p| p > 40).count();
                println!(
                    "frame {i}: mean {mean}, {ink} pixels above 40, waited {}ms",
                    waited.elapsed().as_millis()
                );
            }
            None => println!("frame {i}: nothing (idle or failed)"),
        }
        if !app.alive() {
            println!("app exited");
            break;
        }
    }
    println!(
        "{got}/{frames} frames in {}ms, last written to /tmp/wl_probe.pgm",
        loop_began.elapsed().as_millis()
    );
    Ok(())
}
