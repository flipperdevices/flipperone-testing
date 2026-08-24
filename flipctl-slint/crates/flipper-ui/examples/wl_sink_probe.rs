//! Present frames to a compositor and read its keys, at panel size.
//!
//! Proves the other half of the hosting story: flipctl's own frames arriving on
//! the panel through a compositor rather than through DRM, with the same
//! `FrameSink` and `InputSource` the KMS path implements.

use std::time::{Duration, Instant};

use flipper_ui::pixel::{Gray8, Rect};
use flipper_ui::platform::{Frame, FrameSink, InputSource};
use flipper_ui::wl_sink::WlSink;
use flipper_ui::{PANEL_H, PANEL_W};

fn main() -> std::io::Result<()> {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(20);

    let w = usize::from(PANEL_W);
    let h = usize::from(PANEL_H);
    let mut sink = WlSink::new(PANEL_W, PANEL_H)?;
    println!("surface up at {PANEL_W}x{PANEL_H}");

    let mut px = vec![Gray8(0); w * h];
    let mut frames = 0u32;
    let mut keys = 0u32;
    let began = Instant::now();
    let mut last = Instant::now();

    while began.elapsed() < Duration::from_secs(seconds) && !sink.closed() {
        while let Some(ev) = sink.poll() {
            if ev.down {
                keys += 1;
                println!("key {:?} ({keys} so far)", ev.key);
            }
        }

        // A moving bar, a frame counter in blocks, and a fixed ladder so the grey
        // ramp is visible: enough to tell a live frame from a stale one by eye.
        px.fill(Gray8(0x20));
        let x = (frames as usize * 3) % w;
        for y in 8..24 {
            for i in 0..28 {
                px[y * w + (x + i) % w] = Gray8(0xFF);
            }
        }
        for step in 0..8 {
            let v = (step * 32) as u8;
            for y in 40..64 {
                for i in 0..24 {
                    px[y * w + step * 26 + i] = Gray8(v);
                }
            }
        }
        for k in 0..(keys.min(20) as usize) {
            for y in 80..100 {
                for i in 0..8 {
                    px[y * w + 8 + k * 10 + i] = Gray8(0xFF);
                }
            }
        }

        sink.commit(
            Frame::new(&px, PANEL_W, PANEL_H),
            Rect { x: 0, y: 0, w: PANEL_W, h: PANEL_H },
        )?;
        frames += 1;
        if last.elapsed() >= Duration::from_secs(2) {
            println!(
                "{frames} frames, {:.1} fps",
                f64::from(frames) / began.elapsed().as_secs_f64()
            );
            last = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    println!("done: {frames} frames, {keys} keys");
    Ok(())
}
