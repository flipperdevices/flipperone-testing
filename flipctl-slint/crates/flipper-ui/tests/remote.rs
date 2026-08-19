//! The browser view's wire protocol, exercised over a real socket.
//!
//! Only built with `--features remote`.

#![cfg(feature = "remote")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use flipper_ui::pixel::{Gray8, Rect};
use flipper_ui::platform::{Frame, FrameSink, InputSource};
use flipper_ui::remote::RemoteView;
use flipper_ui::{FlipperKey, PANEL_H, PANEL_W};

fn view() -> RemoteView {
    RemoteView::bind(
        "127.0.0.1:0",
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/remote"),
    )
    .expect("bind")
}

fn request(addr: std::net::SocketAddr, request: &str) -> (String, Vec<u8>) {
    let mut stream = TcpStream::connect(addr).expect("connect");
    stream.write_all(request.as_bytes()).expect("write");
    let mut reader = BufReader::new(stream);

    let mut status = String::new();
    reader.read_line(&mut status).expect("status line");
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("header");
        if line.trim_end().is_empty() {
            break;
        }
    }
    let mut body = Vec::new();
    reader.read_to_end(&mut body).expect("body");
    (status, body)
}

#[test]
fn serves_the_page_and_the_device_photo() {
    let view = view();
    let addr = view.addr();

    let (status, body) = request(addr, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    assert!(status.contains("200"), "page status: {status}");
    let page = String::from_utf8_lossy(&body);
    assert!(page.contains("<canvas id=\"panel\""), "page has the panel canvas");
    // The hitmap's wire names must be names the device actually accepts.
    for key in FlipperKey::ALL {
        assert!(
            page.contains(&format!("'{}'", key.name())),
            "the page has no zone or keybinding for {}",
            key.name()
        );
    }

    let (status, body) = request(addr, "GET /device.png HTTP/1.1\r\nHost: x\r\n\r\n");
    assert!(status.contains("200"), "photo status: {status}");
    assert_eq!(&body[1..4], b"PNG", "device.png is a PNG");
}

/// With nobody watching, a commit must do no work. That is what lets the view be
/// compiled into flipctl without being a tax when unused.
#[test]
fn commits_are_free_while_unwatched() {
    let mut view = view();
    assert_eq!(view.viewers(), 0);

    let pixels = vec![Gray8::WHITE; usize::from(PANEL_W) * usize::from(PANEL_H)];
    view
        .commit(
            Frame::new(&pixels, PANEL_W, PANEL_H),
            Rect::new(0, 0, PANEL_W, PANEL_H),
        )
        .expect("commit");
    assert_eq!(view.viewers(), 0);
}

/// A viewer gets a whole frame, header first, as soon as one is available.
///
/// Whole frames rather than damaged regions: a single shared damage accumulator
/// is drained by whichever viewer reads first, so a second viewer or a reconnect
/// would get a partial screen. 36 KB at 10fps is affordable; a wrong screen is
/// not.
#[test]
fn streams_whole_frames_with_a_header() {
    let mut view = view();
    let addr = view.addr();

    let mut pixels = vec![Gray8::WHITE; usize::from(PANEL_W) * usize::from(PANEL_H)];
    pixels[0] = Gray8::BLACK;

    // Damage accumulated while unwatched.
    view
        .commit(
            Frame::new(&pixels, PANEL_W, PANEL_H),
            Rect::new(0, 0, 10, 10),
        )
        .expect("unwatched commit");

    let mut stream = TcpStream::connect(addr).expect("connect");
    stream
        .write_all(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
        .expect("write");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("timeout");
    let mut reader = BufReader::new(stream);

    let mut status = String::new();
    reader.read_line(&mut status).expect("status");
    assert!(status.contains("200"), "stream status: {status}");
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("header");
        if line.trim_end().is_empty() {
            break;
        }
    }

    // Wait for the server to register the viewer before committing.
    for _ in 0..100 {
        if view.viewers() > 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(view.viewers(), 1, "the stream must register as a viewer");

    view
        .commit(
            Frame::new(&pixels, PANEL_W, PANEL_H),
            Rect::new(20, 20, 8, 4),
        )
        .expect("watched commit");

    // One chunk: hex length, CRLF, body, CRLF.
    let mut size_line = String::new();
    reader.read_line(&mut size_line).expect("chunk size");
    let size = usize::from_str_radix(size_line.trim_end(), 16).expect("hex chunk size");
    let mut body = vec![0; size];
    reader.read_exact(&mut body).expect("chunk body");

    let x = u16::from_le_bytes([body[0], body[1]]);
    let y = u16::from_le_bytes([body[2], body[3]]);
    let w = u16::from_le_bytes([body[4], body[5]]);
    let h = u16::from_le_bytes([body[6], body[7]]);

    assert_eq!((x, y), (0, 0), "whole frames always start at the origin");
    assert_eq!((w, h), (PANEL_W, PANEL_H), "a whole frame, not a sub-region");
    assert_eq!(size, 8 + usize::from(w) * usize::from(h), "header plus w*h bytes");
    assert_eq!(body[8], Gray8::BLACK.0, "the black pixel at (0,0) came through");
}

/// A POST becomes a key event on the same queue the buttons feed.
#[test]
fn input_posts_become_key_events() {
    let mut view = view();
    let addr = view.addr();

    for (key, down) in [(FlipperKey::View, true), (FlipperKey::Run, false)] {
        let body = format!("{{\"key\":\"{}\",\"down\":{down}}}", key.name());
        let mut stream = TcpStream::connect(addr).expect("connect");
        write!(
            stream,
            "POST /input HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .expect("write");
        drop(stream);

        let mut got = None;
        for _ in 0..100 {
            if let Some(event) = view.poll() {
                got = Some(event);
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let event = got.expect("the POST should have produced an event");
        assert_eq!(event.key, key);
        assert_eq!(event.down, down);
    }

    // An unknown key name is ignored rather than crashing the connection.
    let body = "{\"key\":\"del\",\"down\":true}";
    let mut stream = TcpStream::connect(addr).expect("connect");
    write!(
        stream,
        "POST /input HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
    .expect("write");
    drop(stream);
    std::thread::sleep(Duration::from_millis(100));
    assert!(view.poll().is_none(), "there is no Del key");
}

/// The case a shared damage accumulator got wrong: a viewer that connects after
/// another has already drained it must still receive a complete screen.
#[test]
fn a_second_viewer_also_gets_a_whole_frame() {
    let mut view = view();
    let addr = view.addr();

    let mut pixels = vec![Gray8::WHITE; usize::from(PANEL_W) * usize::from(PANEL_H)];
    pixels[0] = Gray8::BLACK;

    let mut first_frames = Vec::new();
    for round in 0..2 {
        let mut stream = TcpStream::connect(addr).expect("connect");
        stream
            .write_all(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
            .expect("write");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("timeout");
        let mut reader = BufReader::new(stream);

        let mut line = String::new();
        reader.read_line(&mut line).expect("status");
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).expect("header");
            if header.trim_end().is_empty() {
                break;
            }
        }

        for _ in 0..100 {
            if view.viewers() > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        view
            .commit(
                Frame::new(&pixels, PANEL_W, PANEL_H),
                Rect::new(0, 0, PANEL_W, PANEL_H),
            )
            .expect("commit");

        // Skip any keepalive and take the first real frame.
        let (w, h) = loop {
            let mut size_line = String::new();
            reader.read_line(&mut size_line).expect("chunk size");
            let size = usize::from_str_radix(size_line.trim_end(), 16).expect("hex");
            let mut body = vec![0; size];
            reader.read_exact(&mut body).expect("body");
            let mut crlf = [0; 2];
            reader.read_exact(&mut crlf).expect("chunk crlf");
            let w = u16::from_le_bytes([body[4], body[5]]);
            let h = u16::from_le_bytes([body[6], body[7]]);
            if w != 0 && h != 0 {
                break (w, h);
            }
        };
        first_frames.push((round, w, h));
        drop(reader);
        for _ in 0..100 {
            if view.viewers() == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    assert_eq!(
        first_frames,
        vec![(0, PANEL_W, PANEL_H), (1, PANEL_W, PANEL_H)],
        "both viewers must receive a complete screen"
    );
}
