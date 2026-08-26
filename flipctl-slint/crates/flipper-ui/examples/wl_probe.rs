//! Host one app the way flipctl does, press keys at it, and write what it drew.
//!
//! Usage: wl_probe "<command>" [dir] [keys]
//!
//!     wl_probe "./target/release/sysmon-app" apps/sysmon v,b,down,down
//!
//! Keys are the panel's own names, sent through the same virtual keyboard flipctl
//! uses, which is the part a generic injector gets wrong: a tool that creates a
//! keyboard per press loses the press while its keymap is still arriving.
//!
//! Each frame's mean grey says whether anything was drawn, and the last frame is
//! written as a PGM so the proof is a picture rather than a claim.

use std::path::Path;
use std::time::{Duration, Instant};

use flipper_ui::key::FlipperKey;

/// A key by the name the panel's silkscreen uses.
fn named(name: &str) -> Option<FlipperKey> {
    Some(match name {
        "up" => FlipperKey::Up,
        "down" => FlipperKey::Down,
        "left" => FlipperKey::Left,
        "right" => FlipperKey::Right,
        "ok" => FlipperKey::Ok,
        "back" => FlipperKey::Back,
        "esc" | "escape" | "z" => FlipperKey::Escape,
        "view" | "x" => FlipperKey::View,
        "power" | "c" => FlipperKey::Power,
        "edit" | "v" => FlipperKey::Edit,
        "run" | "b" => FlipperKey::Run,
        "ptt" | "a" => FlipperKey::Ptt,
        _ => return None,
    })
}

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "sleep 60".into());
    let dir = args.next().unwrap_or_else(|| ".".into());
    let keys: Vec<FlipperKey> = args
        .next()
        .unwrap_or_default()
        .split(',')
        .filter_map(named)
        .collect();

    let (w, h) = (
        u32::from(flipper_ui::PANEL_W),
        u32::from(flipper_ui::PANEL_H),
    );
    println!("hosting {command:?} in {dir} on a {w}x{h} output");

    let began = Instant::now();
    let mut host = flipper_ui::sway::Host::start()?;
    let place = host.place(w, h)?;
    let (runtime, display) = host.display();
    let (runtime, display) = (runtime.to_path_buf(), display.to_string());
    let mut app = flipper_ui::wl::Session::attach(
        &runtime,
        &display,
        &place.output,
        &command,
        Path::new(&dir),
        w,
        h,
        // Passed through so the app's own protocol trace can be read here, which is
        // how "the key never arrived" gets told apart from "the key was ignored".
        &std::env::var("WAYLAND_DEBUG")
            .map(|v| vec![format!("WAYLAND_DEBUG={v}")])
            .unwrap_or_default(),
        false,
    )?;
    // The keyboard goes to the focused surface, so the app has to have the focus
    // its workspace would give it on the panel.
    host.focus(&place)?;
    println!("up in {}ms", began.elapsed().as_millis());
    // Frames are read by the session's own thread, so ask for a stream and take
    // whatever has arrived.
    app.stream(true);

    // One press per step, with the frames either side of it, so a key that changes
    // the screen shows up as a change in the picture.
    let steps = keys.len().max(1) + 1;
    for step in 0..steps {
        // Long enough for a once-a-second app to have ticked, so a step shows the
        // app as it settles rather than as it started.
        std::thread::sleep(Duration::from_millis(1200));
        if let Some(key) = keys.get(step.wrapping_sub(1)) {
            println!("press {key:?}");
            app.key(u32::from(key.to_evdev()), true);
            std::thread::sleep(Duration::from_millis(60));
            app.key(u32::from(key.to_evdev()), false);
        }
        let waited = Instant::now();
        let mut frame = None;
        while waited.elapsed() < Duration::from_millis(3000) {
            frame = app.fresh();
            if frame.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        match frame {
            Some(grey) => {
                let mut pgm = format!("P5\n{w} {h}\n255\n").into_bytes();
                pgm.extend_from_slice(&grey);
                let path = format!("/tmp/wl_probe-{step}.pgm");
                std::fs::write(&path, pgm)?;
                let mean: u32 = grey.iter().map(|&p| u32::from(p)).sum::<u32>() / grey.len() as u32;
                let ink = grey.iter().filter(|&&p| p < 128).count();
                println!("step {step}: mean {mean}, {ink} pixels of ink, {path}");
            }
            None => println!("step {step}: nothing (idle or failed)"),
        }
        if !app.alive() {
            println!("app exited");
            break;
        }
    }
    Ok(())
}
