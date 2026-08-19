//! Print the top-left and bottom-right corners of the real selector frame, for
//! comparison against a Slint `border-radius` rectangle of the same geometry.

use flipper_ui::paint::Corners;
use flipper_ui::theme::{color, metric, radius};
use flipper_ui::Surface;

fn main() {
    let mut s = Surface::panel();
    s.clear(color::WHITE);
    s.selector_frame(
        metric::SELECTOR_X,
        metric::LIST_CONTAINER_Y + metric::SELECTOR_Y_OFFSET,
        metric::SELECTOR_W_FULL,
        metric::SELECTOR_H,
        radius::MENU,
        Corners::default(),
        None,
        color::BLACK,
    );

    let dump = |label: &str, x0: u16, y0: u16, w: u16, h: u16| {
        println!("--- {label}  (x{x0}..{}, y{y0}..{}) ---", x0 + w - 1, y0 + h - 1);
        print!("      ");
        for c in 0..w {
            print!("{:4}", x0 + c);
        }
        println!();
        for r in 0..h {
            print!("  y{:3} ", y0 + r);
            for c in 0..w {
                print!("{:4}", s.get(x0 + c, y0 + r).0);
            }
            println!();
        }
        println!();
    };

    dump("paint.rs selector top-left, r=3", 4, 24, 7, 7);
    dump("paint.rs selector bottom-right, r=3", 245, 40, 8, 8);
}
