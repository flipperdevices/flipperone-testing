//! The on-screen keyboard: its ragged geometry, its navigation and the field.
//!
//! Geometry is checked against numbers read out of the prototype rather than out
//! of this port, because the whole point of the port is to land on the same
//! pixels: `drawKeyboard`'s 15px keys, 35px wide keys and left padding put `q`
//! over `a` over `z`, and the number row's lift range works out at 13px.

use flipper_ui::key::FlipperKey::{Back, Down, Edit, Left, Ok, Right, Run, Up, View};
use flipper_ui::keyboard::{self, Exit, Focus, Grid, Layout, Shift, TextInput};

/// Press a key with the text always considered valid.
fn press(input: &mut TextInput, key: flipper_ui::key::FlipperKey) -> Option<Exit> {
    input.key(key, true)
}

/// The ABC layout is as wide as its widest row: 35 + 11 * 15 + 35.
#[test]
fn the_chrome_is_as_wide_as_its_widest_row() {
    let grid = Grid::new(Layout::Abc);
    assert_eq!(grid.width(), 235);
    // Three rows reach that width; the number row is one wide key short.
    assert_eq!(grid.row_width(0), 200);
    assert_eq!(grid.row_width(1), 235);
    assert_eq!(grid.row_width(2), 235);
    assert_eq!(grid.row_width(3), 235);
}

/// Rows with no leading wide key are padded by one, so the letter columns line
/// up: `q`, `a` and `z` all start at the same x.
#[test]
fn letter_columns_line_up_across_rows() {
    let grid = Grid::new(Layout::Abc);
    let q = grid.cell_x(1, 0);
    let a = grid.cell_x(2, 1);
    let z = grid.cell_x(3, 1);
    assert_eq!((q, a, z), (35, 35, 35));
    // And the number row sits over the letters, 1 above q.
    assert_eq!(grid.cell_x(0, 0), 35);
}

/// The number row lives above the chrome and takes none of its height.
#[test]
fn the_number_row_is_outside_the_chrome() {
    let grid = Grid::new(Layout::Abc);
    assert!(grid.has_peek());
    assert_eq!(grid.chrome_rows(), 3, "four rows, one of them above");

    // A symbol layout has no number row: its digits are an ordinary row.
    let sym = Grid::new(Layout::Sym);
    assert!(!sym.has_peek());
    assert_eq!(sym.chrome_rows(), 3);
}

/// At rest the number row shows a 2px tab; selected, it clears the chrome. The
/// difference is the 13px the prototype's comment names.
#[test]
fn the_number_row_rests_low_and_rises_when_selected() {
    let mut input = TextInput::new("t", "");
    let folded = input.placed()[0].y;
    // Up from QWERTY lands on the number row, which starts the lift.
    press(&mut input, Up);
    // The wave eases, so take it at the end.
    std::thread::sleep(std::time::Duration::from_millis(220));
    let _ = input.animating();
    let popped = input.placed()[0].y;
    assert_eq!(folded - popped, 13, "lift range");
    // A card sunk behind the QWERTY row paints only its top edge.
    let mut fresh = TextInput::new("t", "");
    assert_eq!(fresh.placed()[0].clip_h, 2);
    assert_eq!(fresh.placed()[12].clip_h, 16, "an ordinary key never clips");
    let _ = fresh.animating();
}

/// The keyboard opens on QWERTY, not on the number row: the numbers are the extra
/// reached with Up.
#[test]
fn it_opens_on_the_letters() {
    let input = TextInput::new("Profile name", "abc");
    assert_eq!(input.row, 1);
    assert_eq!(input.col, 0);
    assert_eq!(input.cursor, 3, "the caret starts after the seeded text");
}

/// Typing inserts at the caret; one-shot shift capitalises exactly one letter.
#[test]
fn shift_capitalises_one_letter_and_releases() {
    let mut input = TextInput::new("t", "");
    // Down snaps to the column above, so `q` leads to `a` and then `z`; the shift
    // key is the wide cell to their left.
    press(&mut input, Down);
    press(&mut input, Down);
    press(&mut input, Left);
    assert!(input.on_shift(), "expected the shift key, got {:?}", input.col);
    press(&mut input, Ok);
    assert_eq!(input.shift, Shift::Once);

    press(&mut input, Right);
    press(&mut input, Ok);
    assert_eq!(input.text, "Z");
    assert_eq!(input.shift, Shift::Off, "one-shot shift releases");

    press(&mut input, Ok);
    assert_eq!(input.text, "Zz");
}

/// Caps lock holds until it is turned off.
#[test]
fn caps_lock_holds() {
    let mut input = TextInput::new("t", "");
    input.latch_caps();
    press(&mut input, Ok);
    press(&mut input, Right);
    press(&mut input, Ok);
    assert_eq!(input.text, "QW");
    assert_eq!(input.shift, Shift::Caps);
}

/// The caret travels through the text rather than always sitting at its end.
#[test]
fn the_caret_moves_inside_the_field() {
    let mut input = TextInput::new("t", "abc");
    press(&mut input, Up);
    press(&mut input, Up);
    assert_eq!(input.focus, Focus::Field);
    press(&mut input, Left);
    press(&mut input, Left);
    assert_eq!(input.cursor, 1);
    // Down off the field lands on the keyboard's top row, which in ABC is the
    // number row, and what it types goes in at the caret.
    press(&mut input, Down);
    press(&mut input, Ok);
    assert_eq!(input.text, "a1bc");
}

/// The V key deletes and the X key swaps the layout, which is where the two tabs
/// under the keyboard sit.
#[test]
fn the_tabs_delete_and_swap_the_layout() {
    let mut input = TextInput::new("t", "ab");
    press(&mut input, Edit);
    assert_eq!(input.text, "a");
    assert_eq!(input.tab_pressed(), 2);

    press(&mut input, View);
    assert_eq!(input.layout, Layout::Sym);
    assert_eq!(input.tab_pressed(), 1);
    press(&mut input, View);
    assert_eq!(input.layout, Layout::Abc);
}

/// The wide cell at the head of a symbol row swaps the two symbol layouts, and
/// emits nothing.
#[test]
fn the_symbol_layouts_swap_between_themselves() {
    let mut input = TextInput::new("t", "");
    press(&mut input, View);
    assert_eq!(input.layout, Layout::Sym);
    // The swap keeps the selection, which in this layout is that wide cell.
    assert_eq!((input.row, input.col), (1, 0));
    press(&mut input, Ok);
    assert_eq!(input.layout, Layout::Sym2);
    assert_eq!(input.text, "", "a layout switch types nothing");
}

/// Done commits, and is refused while the caller says the text is unusable.
#[test]
fn done_is_refused_while_the_text_is_invalid() {
    let mut input = TextInput::new("t", "abc");
    assert_eq!(input.key(Run, false), None);
    assert_eq!(input.key(Run, true), Some(Exit::Save("abc".into())));
}

/// Leaving an unchanged field just leaves; leaving a changed one asks first.
#[test]
fn leaving_asks_only_when_there_is_something_to_lose() {
    let mut unchanged = TextInput::new("t", "abc");
    assert_eq!(press(&mut unchanged, Back), Some(Exit::Cancel));

    let mut changed = TextInput::new("t", "abc");
    press(&mut changed, Ok);
    assert_eq!(press(&mut changed, Back), None);
    assert_eq!(changed.discard, Some(0), "Keep is highlighted first");
    // Keep dismisses and the text survives.
    assert_eq!(press(&mut changed, Ok), None);
    assert_eq!(changed.discard, None);
    assert!(changed.text.ends_with('q'));
    // Discard leaves.
    press(&mut changed, Back);
    press(&mut changed, Down);
    assert_eq!(changed.discard, Some(1));
    assert_eq!(press(&mut changed, Ok), Some(Exit::Cancel));
}

/// Text that fits is shown whole, and the caret sits one pixel past it.
#[test]
fn short_text_is_not_truncated() {
    let fitted = keyboard::fit_input("abc", 3, 138);
    assert_eq!(fitted.visible, "abc");
    assert_eq!(
        fitted.cursor_dx,
        i32::from(flipper_ui::font::TITLE.text_width("abc")) + 1
    );
}

/// Text too long for the field is windowed around the caret, and each truncated
/// side is marked.
#[test]
fn long_text_is_windowed_around_the_caret() {
    let long = "abcdefghijklmnopqrstuvwxyz0123456789";
    let inner = 60;

    let at_start = keyboard::fit_input(long, 0, inner);
    assert!(at_start.visible.starts_with('a'), "{}", at_start.visible);
    assert!(at_start.visible.ends_with("...>"), "{}", at_start.visible);

    let at_end = keyboard::fit_input(long, long.len(), inner);
    assert!(at_end.visible.starts_with("<..."), "{}", at_end.visible);
    assert!(at_end.visible.ends_with('9'), "{}", at_end.visible);

    let middle = keyboard::fit_input(long, 18, inner);
    assert!(middle.visible.starts_with("<..."), "{}", middle.visible);
    assert!(middle.visible.ends_with("...>"), "{}", middle.visible);
    for f in [&at_start, &at_end, &middle] {
        assert!(
            i32::from(flipper_ui::font::TITLE.text_width(&f.visible)) <= inner,
            "{} overruns the field",
            f.visible
        );
    }
}

/// The field grows with its text between the two caps the prototype sets.
#[test]
fn the_field_grows_with_the_text() {
    assert_eq!(keyboard::field_w(0), 150, "the minimum");
    assert_eq!(keyboard::field_w(200), 212);
    assert_eq!(keyboard::field_w(1000), 238, "the cap");
}
