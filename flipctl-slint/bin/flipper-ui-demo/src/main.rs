//! Walks the flipper-ui component set on the panel, or headlessly to a PNG.
//!
//! Modes:
//!   --panel        DRM/KMS + evdev on the device (needs the `device` feature)
//!   --png <path>   render one frame and exit (needs the `slint` feature)
//!
//! On the panel: up and down move the selection, ok flashes the press state,
//! back or esc exits.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    let value = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };

    if has("--help") || args.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::SUCCESS;
    }

    let result = if has("--panel") || has("--headless") {
        let frames = value("--frames").and_then(|v| v.parse::<u64>().ok());
        panel(
            value("--kms-device").as_deref(),
            frames,
            has("--auto") || has("--bench"),
            has("--bench"),
            value("--remote"),
            value("--assets"),
            has("--headless"),
            value("--peer"),
        )
    } else if let Some(path) = value("--png") {
        png(&path, value("--press").and_then(|v| v.parse::<i32>().ok()))
    } else {
        eprintln!("{}", USAGE);
        return ExitCode::FAILURE;
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("flipper-ui-demo: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The app list and an app form supply their own soft labels; the list has none.
#[cfg(feature = "slint")]
const EMPTY_HINTS: [String; 0] = [];

const USAGE: &str = "\
usage: flipper-ui-demo [--panel [--kms-device PATH]] [--png PATH]

  --panel        drive the real 256x144 SPI panel and its buttons
  --kms-device   override device autodetection (default: probe /dev/dri/card*
                 for the flipper_one_display driver)
  --frames N     exit after N committed frames, reporting timings
  --auto         advance the selection on a timer, so frames are produced
                 without anyone pressing a button
  --bench        redraw as fast as the panel accepts, to measure the ceiling
  --remote ADDR  also serve the browser view, e.g. 0.0.0.0:8080
  --headless     serve the browser view only: no KMS, no buttons. Lets cog keep
                 the panel, so the prototype and this can be compared live
  --peer H:P     a host:port running the fake-flipctl2 prototype; / then serves
                 the side-by-side comparison and /device the photo view
  --assets DIR   where device.png lives (default: crates/flipper-ui/assets/remote)
  --png PATH     render one frame headlessly and write an 8-bit greyscale PNG
  --press SLOT   with --png, draw soft slot SLOT in its pressed state. The real
                 flash is 30ms, too brief to catch over the remote view";

#[cfg(feature = "slint")]
mod demo {
    use flipper_ui::ui::{ListItem, Root};

    fn labels(list: &[&str]) -> slint::ModelRc<slint::SharedString> {
        slint::ModelRc::new(slint::VecModel::from(
            list.iter()
                .map(|s| slint::SharedString::from(*s))
                .collect::<Vec<_>>(),
        ))
    }

    /// The one window, holding both screens. Idle is the root: `view` opens the
    /// menu and `back` returns.
    pub fn build() -> Root {
        let screen = Root::new().expect("create Root");
        let items: Vec<ListItem> = MENU
            .iter()
            .map(|(label, status, icon, frames)| ListItem {
                label: (*label).into(),
                status: (*status).into(),
                icon: *icon,
                frames: *frames,
            })
            .collect();
        screen.set_total(items.len() as i32);
        screen.set_items(slint::ModelRc::new(slint::VecModel::from(items)));
        screen.set_real_frame(true);
        screen.set_idle_hints(labels(&IDLE_LABELS));
        screen.set_menu_hints(labels(&SOFT_LABELS));
        screen
    }

    #[allow(dead_code)]
    #[allow(dead_code)]
    pub const ROWS: i32 = MENU.len() as i32;

    /// The idle screen's soft keys. desktop.js puts "Menu" in slot 1, whose key is
    /// `view`, and the boot target's shortcut on the right in slot 4, `run`.
    pub const IDLE_LABELS: [&str; 5] = ["", "Menu", "", "", "Desktop"];

    /// The main menu, copied from fake-flipctl2's `menuItems` and its icon maps.
    ///
    /// Slot 0 is the active boot target's app, which is Desktop Computer on a
    /// desktop profile and TV Media Box on that target. Four rows have no static
    /// icon and fall back to frame 0 of their animated strip while unselected,
    /// which is exactly the look the prototype wants.
    ///
    /// `icon` indexes the table in list.slint; `frames` is 1 for a static icon.
    /// No row carries status text: menu.js builds every MenuLine with just a
    /// label, an icon and the active-label nudge. `MenuLine` supports a status
    /// column, and submenus use it, but the main menu does not.
    pub const MENU: [(&str, &str, i32, i32); 7] = [
        ("Desktop Computer", "", 1, 1),
        ("Boot Menu", "", 2, 1),
        ("Apps", "", 3, 9),
        ("Files", "", 4, 10),
        ("Network", "", 5, 10),
        ("Testing", "", 6, 9),
        ("Settings", "", 7, 10),
    ];

    /// Bottom-bar labels, one per physical soft key, in silkscreen order.
    ///
    /// Index i labels `FlipperKey::SOFT_ROW[i]`, so a label and the key beneath it
    /// are declared once and cannot drift apart. An empty string draws no button.
    ///
    /// The main menu shows none, matching the prototype: its MenuScene has no
    /// button bar at all, and only its power-off modal puts anything there.
    pub const SOFT_LABELS: [&str; 5] = ["", "", "", "", ""];
}

/// Show a list of apps, or an app's own form, on the shared list body.
#[cfg(feature = "slint")]
fn apply_app_list(
    screen: &flipper_ui::ui::Root,
    rows: &[(String, String)],
    selected: i32,
    hints: &[String],
) {
    let items: Vec<flipper_ui::ui::ListItem> = rows
        .iter()
        .map(|(label, value)| flipper_ui::ui::ListItem {
            label: label.as_str().into(),
            status: value.as_str().into(),
            // Apps have no icons yet. The column stays reserved so a manifest can
            // name one later without the labels shifting.
            icon: 0,
            frames: 1,
        })
        .collect();
    screen.set_app_total(items.len() as i32);
    screen.set_app_selected(selected);
    screen.set_app_items(slint::ModelRc::new(slint::VecModel::from(items)));
    screen.set_app_hints(slint::ModelRc::new(slint::VecModel::from(
        hints
            .iter()
            .map(|h| slint::SharedString::from(h.as_str()))
            .collect::<Vec<_>>(),
    )));
}

/// Copy the idle screen's own fields across.
#[cfg(feature = "slint")]
fn apply_idle(screen: &flipper_ui::ui::Root, idle: &flipper_ui::status::Idle) {
    const UNKNOWN: i32 = -32768;
    screen.set_battery_temp(idle.battery_temp.unwrap_or(UNKNOWN));
    screen.set_cpu_temp(idle.cpu_temp.unwrap_or(UNKNOWN));
    screen.set_power_mw(idle.power_mw.unwrap_or(UNKNOWN));
    screen.set_hostname(idle.hostname.as_str().into());
    screen.set_profile(idle.profile.as_str().into());
    screen.set_links(slint::ModelRc::new(slint::VecModel::from(
        idle.links
            .iter()
            .map(|l| flipper_ui::ui::IdleLink {
                name: l.name.as_str().into(),
                v4: l.v4.as_str().into(),
                v6: l.v6.as_str().into(),
            })
            .collect::<Vec<_>>(),
    )));
}

/// Copy a status reading into the screen's properties.
#[cfg(feature = "slint")]
fn apply_status(screen: &flipper_ui::ui::Root, s: flipper_ui::Status) {
    use flipper_ui::Ethernet;
    use slint::ComponentHandle;
    let _ = screen.as_weak();
    screen.set_battery(s.battery);
    screen.set_charging(s.charging);
    screen.set_wifi_connected(s.wifi_connected);
    screen.set_wifi_quality(s.wifi_quality);
    screen.set_ethernet(match s.ethernet {
        Ethernet::Down => 0,
        Ethernet::Real => 1,
        Ethernet::Usb => 2,
    });
    screen.set_modem_available(s.modem_available);
    screen.set_access_tech(s.access_tech.into());
    screen.set_modem_quality(s.modem_quality);
}

#[cfg(feature = "slint")]
fn png(path: &str, press: Option<i32>) -> std::io::Result<()> {
    use std::time::Duration;

    use flipper_ui::slint_render::{render_frame, FlipperSlintPlatform};
    use flipper_ui::{PANEL_H, PANEL_W};
    use slint::ComponentHandle;

    let window = FlipperSlintPlatform::install();
    // Root defaults to the idle screen, which is what a headless render shows.
    let screen = demo::build();
    screen.show().expect("show");
    let mut status = flipper_ui::StatusSource::new(Duration::from_millis(0));
    if let Some(now) = status.poll() {
        apply_status(&screen, now);
    }
    apply_idle(&screen, &flipper_ui::status::Idle::read_all());
    if let Some(slot) = press {
        screen.set_idle_pressed_slot(slot);
    }
    slint::platform::update_timers_and_animations();

    let frame = render_frame(&window).expect("the first frame always paints");
    let bytes: Vec<u8> = frame.iter().map(|p| p.0).collect();

    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(
        std::io::BufWriter::new(file),
        u32::from(PANEL_W),
        u32::from(PANEL_H),
    );
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(std::io::Error::other)?
        .write_image_data(&bytes)
        .map_err(std::io::Error::other)?;

    eprintln!("wrote {path}");
    Ok(())
}

#[cfg(not(feature = "slint"))]
fn png(_path: &str, _press: Option<i32>) -> std::io::Result<()> {
    Err(std::io::Error::other("rebuild with --features slint"))
}

#[cfg(all(feature = "device", feature = "slint"))]
fn panel(
    kms_device: Option<&str>,
    max_frames: Option<u64>,
    auto: bool,
    bench: bool,
    remote: Option<String>,
    assets: Option<String>,
    headless: bool,
    peer: Option<String>,
) -> std::io::Result<()> {
    use std::time::{Duration, Instant};

    use flipper_ui::evdev::EvdevSource;
    use flipper_ui::kms::KmsSink;
    use flipper_ui::slint_render::{render_into, FlipperSlintPlatform};
    use flipper_ui::theme::timing;
    use flipper_ui::ui::Screen;
    use flipper_ui::{FlipperKey, Frame, FrameSink, InputSource, PANEL_H, PANEL_W};
    use slint::ComponentHandle;

    // Headless: the browser view is the only output and the only input, so cog
    // (or anything else) can keep the panel. Without it the panel is required.
    if headless && remote.is_none() {
        return Err(std::io::Error::other("--headless needs --remote ADDR"));
    }

    let mut sink = if headless {
        None
    } else {
        let sink = KmsSink::open(kms_device.map(std::path::Path::new))?;
        let (w, h) = sink.size();
        if (w, h) != (PANEL_W, PANEL_H) {
            return Err(std::io::Error::other(format!(
                "panel reports {w}x{h}, this build is compiled for {PANEL_W}x{PANEL_H}"
            )));
        }
        Some(sink)
    };
    // Buttons are left alone in headless mode: whoever owns the panel owns them
    // too, and two readers both reacting would be confusing.
    let mut input = if headless {
        None
    } else {
        Some(EvdevSource::open()?)
    };

    // The browser view is a second sink over the same frames and a second source
    // of the same key events, so nothing downstream can tell a remote click from
    // a finger.
    #[cfg(feature = "remote")]
    let mut web = match remote {
        Some(addr) => {
            let dir = assets
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| "crates/flipper-ui/assets/remote".into());
            let view = flipper_ui::remote::RemoteView::bind_with_peer(&addr, dir, peer.clone())?;
            eprintln!("remote view    http://{}/", view.addr());
            if peer.is_some() {
                eprintln!("comparison     / (photo view at /device)");
            }
            Some(view)
        }
        None => None,
    };
    #[cfg(not(feature = "remote"))]
    if remote.is_some() {
        return Err(std::io::Error::other("rebuild with --features remote"));
    }

    let window = FlipperSlintPlatform::install();
    let screen = demo::build();
    screen.show().expect("show");
    // Three cadences, by what actually moves: sensors every 5s as desktop.js
    // does, addresses every 30s because a cable or a lease can change them, and
    // hostname and profile once because the booted subvol cannot change without a
    // reboot.
    let mut idle = flipper_ui::status::Idle::read_all();
    apply_idle(&screen, &idle);
    let mut sensor_poll = Instant::now();
    let mut link_poll = Instant::now();

    // Apps live next to the binary's workspace root, so a deployed tree finds
    // them without configuration.
    let apps = flipper_ui::app::discover(std::path::Path::new("apps"));
    eprintln!(
        "apps           {} found: {:?}",
        apps.len(),
        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
    );
    let mut app_selected = 0i32;
    let mut running: Option<flipper_ui::RunningApp> = None;

    // Frame buffer is allocated once and reused, so the steady state does not
    // allocate. flipctl inherits this requirement; the boot menu and the
    // installer benefit from it.
    let mut frame = Vec::new();
    let mut selected = 0i32;
    let mut scroll = 0i32;
    // Animated icons advance while a row is selected. Driven here rather than by
    // Slint's animation-tick so the loop knows a repaint is due.
    let mut tick = 0i32;
    let mut icon_tick = Instant::now();
    let mut last_selected = selected;
    let flash = Duration::from_millis(timing::PRESS_FLASH_MS as u64);
    let mut flash_until: Option<Instant> = None;
    // Which soft slot is showing its pressed state, and what to do when the flash
    // ends. The prototype flashes first and acts after: `btn.press()`, then a 30ms
    // timer calls `release()` and the handler. Acting immediately would switch the
    // screen before the inverted button was ever drawn.
    let mut pressed_slot: Option<usize> = None;
    let mut pending: Option<FlipperKey> = None;
    let mut frames = 0u64;
    // Commit latency is the number that matters: the SPI transfer alone is
    // 37152 bytes at 20MHz, about 14.9ms, and the driver re-sends the whole
    // frame on every atomic update.
    let mut render_total = Duration::ZERO;
    let mut commit_total = Duration::ZERO;
    let mut commit_worst = Duration::ZERO;
    let started = Instant::now();
    let mut last_auto = Instant::now();
    // The bar polls sysfs on its own cadence and only reports a change, so an
    // unchanged battery reading never dirties the screen.
    let mut status = flipper_ui::StatusSource::new(Duration::from_secs(1));
    // Merged queue so panel buttons and browser clicks take the same path.
    let mut pending_input: Vec<flipper_ui::KeyEvent> = Vec::new();

    let report = |frames: u64,
                  started: &Instant,
                  render_total: Duration,
                  commit_total: Duration,
                  commit_worst: Duration| {
        let elapsed = started.elapsed();
        eprintln!("frames        {frames}");
        eprintln!("elapsed       {:.2}s", elapsed.as_secs_f32());
        if frames > 0 {
            eprintln!(
                "render mean   {:.2}ms",
                render_total.as_secs_f32() * 1000.0 / frames as f32
            );
            eprintln!(
                "commit mean   {:.2}ms",
                commit_total.as_secs_f32() * 1000.0 / frames as f32
            );
            eprintln!("commit worst  {:.2}ms", commit_worst.as_secs_f32() * 1000.0);
            eprintln!(
                "throughput    {:.1} fps sustained",
                frames as f32 / elapsed.as_secs_f32()
            );
        }
    };

    loop {
        #[cfg(feature = "remote")]
        if let Some(view) = web.as_mut() {
            // A browser opening mid-idle needs the screen as it stands; nothing
            // has changed, so nothing would otherwise be sent.
            if view.take_new_viewer() && !frame.is_empty() {
                eprintln!("remote viewer  connected, sending the current frame");
                view.commit(
                    Frame::new(&frame, PANEL_W, PANEL_H),
                    flipper_ui::Rect::new(0, 0, PANEL_W, PANEL_H),
                )?;
            }
            while let Some(event) = view.poll() {
                pending_input.push(event);
            }
        }
        if let Some(input) = input.as_mut() {
            while let Some(event) = input.poll() {
                pending_input.push(event);
            }
        }

        for event in pending_input.drain(..) {
            if !event.down {
                continue;
            }
            // Report which on-screen slot a soft key sits under, so the log
            // proves the labels line up with the hardware instead of us
            // assuming it.
            let slot = FlipperKey::SOFT_ROW.iter().position(|k| *k == event.key);
            match slot {
                Some(i) if demo::SOFT_LABELS[i].is_empty() => {
                    eprintln!("key {} -> slot {i}, no label", event.key.name())
                }
                Some(i) => eprintln!(
                    "key {} -> slot {i} \"{}\"",
                    event.key.name(),
                    demo::SOFT_LABELS[i]
                ),
                None => eprintln!("key {}", event.key.name()),
            }

            // A labelled soft key must do something, or the label is a lie.
            let on_menu_now = screen.get_screen() == Screen::Menu;
            let labels: &[&str; 5] = if on_menu_now {
                &demo::SOFT_LABELS
            } else {
                &demo::IDLE_LABELS
            };
            let labelled_soft = slot.is_some_and(|i| !labels[i].is_empty());

            // While an app is running it owns the keys, except Back, which is
            // the way out of an app that has stopped responding.
            if let Some(app) = running.as_mut() {
                if screen.get_screen() == Screen::AppForm && event.key == FlipperKey::Back {
                    app.stop();
                    running = None;
                    let rows: Vec<(String, String)> = apps
                        .iter()
                        .map(|a| (a.name.clone(), String::new()))
                        .collect();
                    apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS);
                    screen.set_screen(Screen::Apps);
                } else {
                    app.send(event);
                }
                continue;
            }

            // The app list.
            if screen.get_screen() == Screen::Apps {
                match event.key {
                    FlipperKey::Down if !apps.is_empty() => {
                        app_selected = (app_selected + 1).rem_euclid(apps.len() as i32);
                    }
                    FlipperKey::Up if !apps.is_empty() => {
                        app_selected = (app_selected - 1).rem_euclid(apps.len() as i32);
                    }
                    FlipperKey::Ok | FlipperKey::Run => {
                        if let Some(entry) = apps.get(app_selected as usize) {
                            match flipper_ui::RunningApp::spawn(entry) {
                                Ok(app) => {
                                    eprintln!("app            started {}", entry.name);
                                    running = Some(app);
                                }
                                Err(e) => eprintln!("app            {} failed: {e}", entry.name),
                            }
                        }
                    }
                    FlipperKey::Back | FlipperKey::Escape => screen.set_screen(Screen::Menu),
                    _ => {}
                }
                let rows: Vec<(String, String)> = apps
                    .iter()
                    .map(|a| (a.name.clone(), String::new()))
                    .collect();
                apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS);
                continue;
            }

            match (on_menu_now, event.key) {
                // Back leaves the menu rather than the program: the menu is not
                // the root screen any more.
                //
                // No panel key quits. This runs as a service, so a button that
                // kills the UI is a footgun: `esc` used to exit, which meant one
                // press of the leftmost soft key took the whole screen down.
                // systemctl stop, or --frames, ends it instead.
                (true, FlipperKey::Back) => {
                    screen.set_screen(Screen::Idle);
                    eprintln!("screen         idle");
                }
                (true, FlipperKey::Down) => selected = (selected + 1).rem_euclid(demo::ROWS),
                (true, FlipperKey::Up) => selected = (selected - 1).rem_euclid(demo::ROWS),
                (true, FlipperKey::Ok) if demo::MENU[selected as usize].0 == "Apps" => {
                    let rows: Vec<(String, String)> = apps
                        .iter()
                        .map(|a| (a.name.clone(), String::new()))
                        .collect();
                    apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS);
                    screen.set_screen(Screen::Apps);
                    eprintln!("screen         apps");
                }
                (_, FlipperKey::Ok) => flash_until = Some(Instant::now() + flash),
                // A labelled soft key inverts first and acts when the flash ends.
                _ if labelled_soft => {
                    pressed_slot = slot;
                    pending = Some(event.key);
                    flash_until = Some(Instant::now() + flash);
                }
                _ => {}
            }
        }

        if flash_until.is_some_and(|until| Instant::now() >= until) {
            flash_until = None;
            pressed_slot = None;
            // The flash has been seen; now do what the button says. Idle's slot 1
            // is "Menu", which is where desktop.js puts it.
            if let Some(key) = pending.take() {
                if key == FlipperKey::View && screen.get_screen() == Screen::Idle {
                    screen.set_screen(Screen::Menu);
                    eprintln!("screen         menu");
                }
            }
        }

        // Nothing repaints unless something changed, so an unattended run needs
        // a reason to redraw. Reuse the animated-icon cadence.
        let auto_period = if bench {
            Duration::ZERO
        } else {
            Duration::from_millis(timing::ICON_FRAME_MS as u64)
        };
        if auto && last_auto.elapsed() >= auto_period {
            selected = (selected + 1).rem_euclid(demo::ROWS);
            last_auto = Instant::now();
        }

        if let Some(now) = status.poll() {
            apply_status(&screen, now);
            
            eprintln!(
                "status         battery {}% charging={} eth={:?} wifi={} modem={}",
                now.battery, now.charging, now.ethernet, now.wifi_connected, now.modem_available
            );
        }

        // An app's scenes arrive on their own schedule, so they are pulled every
        // iteration rather than on a timer.
        if let Some(app) = running.as_mut() {
            if app.poll().is_some() {
                let scene = app.scene().clone();
                screen.set_app_title(scene.title.as_str().into());
                match scene.kind {
                    flipper_ui::SceneKind::Log => {
                        screen.set_app_lines(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .rows
                                .iter()
                                .map(|(l, _)| slint::SharedString::from(l.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_app_hints(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .hints
                                .iter()
                                .map(|h| slint::SharedString::from(h.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_app_log_total(scene.total);
                        screen.set_app_log_offset(scene.offset);
                        screen.set_screen(Screen::AppLog);
                    }
                    flipper_ui::SceneKind::Form => {
                        apply_app_list(&screen, &scene.rows, scene.selected, &scene.hints);
                        screen.set_screen(Screen::AppForm);
                    }
                }
            }
            // An app that exits returns the user to the list rather than leaving
            // its last frame on screen forever.
            if app.finished() {
                eprintln!("app            exited");
                running = None;
                let rows: Vec<(String, String)> = apps
                    .iter()
                    .map(|a| (a.name.clone(), String::new()))
                    .collect();
                apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS);
                screen.set_screen(Screen::Apps);
            }
        }

        if sensor_poll.elapsed() >= Duration::from_secs(5) {
            sensor_poll = Instant::now();
            if idle.refresh_sensors() {
                apply_idle(&screen, &idle);
            }
        }
        if link_poll.elapsed() >= Duration::from_secs(30) {
            link_poll = Instant::now();
            if idle.refresh_links() {
                apply_idle(&screen, &idle);
                eprintln!("links          {} interface(s)", idle.links.len());
            }
        }

        // Keep the selection inside the viewport. Navigation wraps, so jumping
        // from the last row to the first has to scroll all the way back.
        let visible = flipper_ui::theme::count::LIST_VISIBLE_ROWS;
        scroll = scroll.clamp(
            (selected - visible + 1).max(0),
            selected.min((demo::ROWS - visible).max(0)),
        );

        screen.set_selected(selected);
        screen.set_scroll(scroll);
        screen.set_pressed(flash_until.is_some() && pressed_slot.is_none());
        screen.set_idle_pressed_slot(pressed_slot.map_or(-1, |i| i as i32));
        // The strip's phase restarts whenever the selection moves. MenuLine.js
        // measures elapsed time from `_selectedAt`, not from a global clock, so the
        // first frame drawn after a row lights up is frame 1. Without the reset a
        // newly selected row can land on frame 0, which is what the unselected row
        // was already showing, and the motion is missed entirely.
        if selected != last_selected {
            last_selected = selected;
            tick = 0;
            icon_tick = Instant::now();
            screen.set_tick(tick);
        } else if icon_tick.elapsed() >= Duration::from_millis(timing::ICON_FRAME_MS as u64) {
            icon_tick = Instant::now();
            tick += 1;
            screen.set_tick(tick);
        }
        slint::platform::update_timers_and_animations();

        let render_start = Instant::now();
        let damage = render_into(&window, &mut frame);
        render_total += render_start.elapsed();

        if let Some(damage) = damage {
            let commit_start = Instant::now();
            let composed = Frame::new(&frame, PANEL_W, PANEL_H);
            if let Some(sink) = sink.as_mut() {
                sink.commit(composed, damage)?;
            }
            #[cfg(feature = "remote")]
            if let Some(view) = web.as_mut() {
                view.commit(composed, damage)?;
            }
            let took = commit_start.elapsed();
            commit_total += took;
            commit_worst = commit_worst.max(took);
            frames += 1;

            if frames == 1 {
                eprintln!(
                    "first frame committed: {}x{} panel, damage {}x{} at ({}, {})",
                    PANEL_W, PANEL_H, damage.w, damage.h, damage.x, damage.y
                );
            }
            if frames == 2 {
                match sink.as_ref() {
                    Some(sink) => eprintln!("flush path    {}", sink.flush_path()),
                    None => eprintln!("flush path    headless, browser only"),
                }
            }
            if max_frames.is_some_and(|max| frames >= max) {
                report(frames, &started, render_total, commit_total, commit_worst);
                return Ok(());
            }
        }

        // Headless has no SPI transfer to pace the loop, so without a sleep it
        // would spin a core rendering frames nobody asked for.
        // The panel has no vblank to wait on and the SPI transfer already costs
        // about 15ms, so a short sleep is enough to keep the loop from spinning
        // on the input fds. A blocking poll(2) over EvdevSource::fds() is the
        // next step, once there is a timer source to fold into it.
        if !bench {
            std::thread::sleep(Duration::from_millis(8));
        }
    }
}

#[cfg(not(all(feature = "device", feature = "slint")))]
fn panel(
    _kms_device: Option<&str>,
    _max_frames: Option<u64>,
    _auto: bool,
    _bench: bool,
    _remote: Option<String>,
    _assets: Option<String>,
    _headless: bool,
    _peer: Option<String>,
) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "rebuild with --features device,slint",
    ))
}
