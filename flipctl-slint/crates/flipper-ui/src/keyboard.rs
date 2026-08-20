//! The on-screen keyboard and the text-input screen around it.
//!
//! Ported from `ui.js` (`UI.Keyboard`), `canvas.js` (`drawKeyboard`) and
//! `keyboard_test.js` (`TextInputScreen`). Geometry and navigation live here
//! rather than in Slint for two reasons: the cell grid is ragged, so every cell
//! position is a running sum no declarative layout expresses, and column
//! alignment on Up/Down is decided by pixel centres, which needs the same sums.
//! Slint is handed a flat list of placed cells.

use crate::key::FlipperKey;
use crate::theme::metric;

/// What a cell does when it is pressed.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind {
    Char,
    Shift,
    /// The language switcher. Drawn, but the prototype wires no behaviour to it.
    Lang,
    Space,
    Backspace,
    /// Form navigation, drawn as an arrow. No behaviour yet, as in the prototype.
    NavUp,
    NavDown,
    /// The wide cell at the head of a symbol row, which swaps the two symbol
    /// layouts.
    SwitchSym,
}

/// One key.
#[derive(Clone, Debug)]
pub struct Cell {
    pub text: &'static str,
    pub kind: Kind,
    pub wide: bool,
    /// A cell of the number row, which sits above the chrome and only shows its
    /// top edge until the wave lifts it.
    pub peek: bool,
}

impl Cell {
    fn ch(text: &'static str) -> Self {
        Self { text, kind: Kind::Char, wide: false, peek: false }
    }
    fn peek(text: &'static str) -> Self {
        Self { text, kind: Kind::Char, wide: false, peek: true }
    }
    fn wide(text: &'static str, kind: Kind) -> Self {
        Self { text, kind, wide: true, peek: false }
    }
    pub fn width(&self) -> i32 {
        if self.wide { metric::KB_WIDE_W } else { metric::KB_BTN_W }
    }
}

/// Which set of keys is showing. `123` swaps ABC for the first symbol layout, and
/// the wide cell at the head of a symbol row swaps the two symbol layouts.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Layout {
    #[default]
    Abc,
    Sym,
    Sym2,
}

impl Layout {
    /// The label the keyboard shows above its leading wide cell.
    pub fn label(self) -> &'static str {
        match self {
            Self::Abc => "EN",
            _ => "123",
        }
    }

    /// What the `123` tab shows, which is where it would take you.
    pub fn tab_label(self) -> &'static str {
        match self {
            Self::Abc => "123",
            _ => "ABC",
        }
    }

    pub fn rows(self) -> Vec<Vec<Cell>> {
        match self {
            Self::Abc => vec![
                vec![
                    Cell::peek("1"),
                    Cell::peek("2"),
                    Cell::peek("3"),
                    Cell::peek("4"),
                    Cell::peek("5"),
                    Cell::peek("6"),
                    Cell::peek("7"),
                    Cell::peek("8"),
                    Cell::peek("9"),
                    Cell::peek("0"),
                    Cell::peek("-"),
                ],
                vec![
                    Cell::ch("q"),
                    Cell::ch("w"),
                    Cell::ch("e"),
                    Cell::ch("r"),
                    Cell::ch("t"),
                    Cell::ch("y"),
                    Cell::ch("u"),
                    Cell::ch("i"),
                    Cell::ch("o"),
                    Cell::ch("p"),
                    Cell::ch("["),
                    Cell::wide("", Kind::NavUp),
                ],
                vec![
                    Cell::wide("", Kind::Lang),
                    Cell::ch("a"),
                    Cell::ch("s"),
                    Cell::ch("d"),
                    Cell::ch("f"),
                    Cell::ch("g"),
                    Cell::ch("h"),
                    Cell::ch("j"),
                    Cell::ch("k"),
                    Cell::ch("l"),
                    Cell::ch(":"),
                    Cell::ch("]"),
                    Cell::wide("", Kind::NavDown),
                ],
                vec![
                    Cell::wide("", Kind::Shift),
                    Cell::ch("z"),
                    Cell::ch("x"),
                    Cell::ch("c"),
                    Cell::ch("v"),
                    Cell::ch("b"),
                    Cell::ch("n"),
                    Cell::ch("m"),
                    Cell::ch(","),
                    Cell::ch("."),
                    Cell::ch("/"),
                    Cell::ch("?"),
                    Cell::wide(" ", Kind::Space),
                ],
            ],
            Self::Sym => vec![
                Self::digit_row(),
                vec![
                    Cell::wide("<>|", Kind::SwitchSym),
                    Cell::ch("+"),
                    Cell::ch("("),
                    Cell::ch(")"),
                    Cell::ch("="),
                    Cell::ch("{"),
                    Cell::ch("}"),
                    Cell::ch("@"),
                    Cell::ch("#"),
                    Cell::ch("$"),
                    Cell::ch("?"),
                    Cell::ch(";"),
                    Cell::wide("", Kind::NavDown),
                ],
                Self::punctuation_row(),
            ],
            Self::Sym2 => vec![
                Self::digit_row(),
                vec![
                    Cell::wide("[]<>", Kind::SwitchSym),
                    Cell::ch("["),
                    Cell::ch("]"),
                    Cell::ch("<"),
                    Cell::ch(">"),
                    Cell::ch("|"),
                    Cell::ch("\""),
                    Cell::ch("'"),
                    Cell::ch("+"),
                    Cell::ch("!"),
                    Cell::ch("?"),
                    Cell::ch(";"),
                    Cell::wide("", Kind::NavDown),
                ],
                Self::punctuation_row(),
            ],
        }
    }

    /// Shared by both symbol layouts: the digits as a normal row, not a peek row.
    fn digit_row() -> Vec<Cell> {
        vec![
            Cell::ch("1"),
            Cell::ch("2"),
            Cell::ch("3"),
            Cell::ch("4"),
            Cell::ch("5"),
            Cell::ch("6"),
            Cell::ch("7"),
            Cell::ch("8"),
            Cell::ch("9"),
            Cell::ch("0"),
            Cell::ch("-"),
            Cell::wide("", Kind::NavUp),
        ]
    }

    fn punctuation_row() -> Vec<Cell> {
        vec![
            Cell::wide("_", Kind::Char),
            Cell::ch("%"),
            Cell::ch("^"),
            Cell::ch("&"),
            Cell::ch("*"),
            Cell::ch("`"),
            Cell::ch("~"),
            Cell::ch("\\"),
            Cell::ch(","),
            Cell::ch("."),
            Cell::ch(":"),
            Cell::ch("/"),
            Cell::wide(".", Kind::Char),
        ]
    }
}

/// Shift is three-state: off, one-shot, and latched by a long press.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Shift {
    #[default]
    Off,
    Once,
    Caps,
}

/// What the arrows and OK act on.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Focus {
    Field,
    Keys,
    Tab123,
    TabBackspace,
}

/// How the caller learns the screen is done with.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Exit {
    Save(String),
    Cancel,
}

/// Geometry of the ragged grid.
///
/// A row whose first cell is not wide is padded left by the widest leading wide
/// cell in the layout, so `q` sits over `a` sits over `z` even though `a` and `z`
/// are preceded by a 35px cell and `q` is not.
pub struct Grid {
    pub rows: Vec<Vec<Cell>>,
}

impl Grid {
    pub fn new(layout: Layout) -> Self {
        Self { rows: layout.rows() }
    }

    fn leading_wide(&self, row: usize) -> i32 {
        match self.rows.get(row).and_then(|r| r.first()) {
            Some(c) if c.wide => metric::KB_WIDE_W,
            _ => 0,
        }
    }

    fn max_leading_wide(&self) -> i32 {
        (0..self.rows.len()).map(|r| self.leading_wide(r)).max().unwrap_or(0)
    }

    pub fn left_offset(&self, row: usize) -> i32 {
        self.max_leading_wide() - self.leading_wide(row)
    }

    pub fn row_width(&self, row: usize) -> i32 {
        self.left_offset(row)
            + self.rows.get(row).map_or(0, |r| r.iter().map(Cell::width).sum::<i32>())
    }

    /// The chrome is as wide as its widest row.
    pub fn width(&self) -> i32 {
        (0..self.rows.len()).map(|r| self.row_width(r)).max().unwrap_or(0)
    }

    pub fn has_peek(&self) -> bool {
        self.rows.first().and_then(|r| r.first()).is_some_and(|c| c.peek)
    }

    /// Rows the chrome is tall. The peek row lives above it and takes no height.
    pub fn chrome_rows(&self) -> i32 {
        self.rows.len() as i32 - i32::from(self.has_peek())
    }

    /// A cell's left edge, from the keyboard's own left edge.
    pub fn cell_x(&self, row: usize, col: usize) -> i32 {
        let mut x = self.left_offset(row);
        if let Some(r) = self.rows.get(row) {
            for c in r.iter().take(col) {
                x += c.width();
            }
        }
        x
    }

    /// A cell's centre, in halves of a pixel so the comparison stays integral.
    fn cell_center_2x(&self, row: usize, col: usize) -> i32 {
        let w = self.rows.get(row).and_then(|r| r.get(col)).map_or(0, Cell::width);
        2 * self.cell_x(row, col) + w
    }

    /// The column in `row` whose centre is nearest `target_2x`, which is what
    /// Up/Down snap to.
    pub fn closest_col(&self, row: usize, target_2x: i32) -> usize {
        let len = self.rows.get(row).map_or(0, Vec::len);
        (0..len)
            .min_by_key(|c| (self.cell_center_2x(row, *c) - target_2x).abs())
            .unwrap_or(0)
    }
}

/// The dock-style lift of the number row.
///
/// One transition drives every kind of move in and out of the row: the centre and
/// the amplitude are both eased, so back-to-back moves chain instead of snapping.
#[derive(Clone, Debug)]
struct Wave {
    rest_center: f32,
    rest_amp: f32,
    anim: Option<WaveAnim>,
}

#[derive(Clone, Debug)]
struct WaveAnim {
    started: std::time::Instant,
    from_center: f32,
    from_amp: f32,
    to_center: f32,
    to_amp: f32,
}

/// ui.js KB_PEEK_WAVE_MS.
const WAVE_MS: f32 = 160.0;

impl Wave {
    fn eval(&self) -> (f32, f32) {
        let Some(a) = self.anim.as_ref() else {
            return (self.rest_center, self.rest_amp);
        };
        let t = (a.started.elapsed().as_secs_f32() * 1000.0 / WAVE_MS).clamp(0.0, 1.0);
        let eased = 1.0 - (1.0 - t).powi(3);
        (
            a.from_center + (a.to_center - a.from_center) * eased,
            a.from_amp + (a.to_amp - a.from_amp) * eased,
        )
    }

    /// True while a repaint is still worth asking for.
    fn running(&mut self) -> bool {
        let Some(a) = self.anim.as_ref() else { return false };
        if a.started.elapsed().as_secs_f32() * 1000.0 >= WAVE_MS {
            self.rest_center = a.to_center;
            self.rest_amp = a.to_amp;
            self.anim = None;
            return false;
        }
        true
    }

    fn drive(&mut self, on_peek: bool, col: usize) {
        let (cur_center, cur_amp) = self.eval();
        let to_amp = if on_peek { 1.0 } else { 0.0 };
        let to_center = if on_peek { col as f32 } else { cur_center };
        // Arriving on a collapsed row: rise in place rather than sweeping in from
        // wherever the centre was last left.
        let from_center = if on_peek && cur_amp < 0.01 { col as f32 } else { cur_center };
        if (from_center - to_center).abs() < 0.001 && (cur_amp - to_amp).abs() < 0.001 {
            return;
        }
        self.anim = Some(WaveAnim {
            started: std::time::Instant::now(),
            from_center,
            from_amp: cur_amp,
            to_center,
            to_amp,
        });
    }

    /// Match the current selection with no animation, for a layout swap: a wave
    /// eased against the outgoing layout would play back as a stray collapse.
    fn snap(&mut self, on_peek: bool, col: usize) {
        self.rest_center = if on_peek { col as f32 } else { 0.0 };
        self.rest_amp = if on_peek { 1.0 } else { 0.0 };
        self.anim = None;
    }
}

/// A placed key, ready to draw.
#[derive(Clone, Debug)]
pub struct Placed {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub text: String,
    pub kind: Kind,
    pub icon: i32,
    pub icon_w: i32,
    pub icon_h: i32,
    pub selected: bool,
    pub pressed: bool,
    /// How much of the cell, from its top, is allowed to paint. Only a peek cell
    /// clips: the rest of it is behind the QWERTY row.
    pub clip_h: i32,
}

/// The text-input screen: a title, the field, the keyboard and the two tabs.
pub struct TextInput {
    pub title: String,
    pub text: String,
    /// Where the cursor sits, in characters.
    pub cursor: usize,
    initial: String,
    pub layout: Layout,
    grid: Grid,
    pub row: usize,
    pub col: usize,
    pub shift: Shift,
    pub focus: Focus,
    pressed: Option<(usize, usize, std::time::Instant)>,
    /// When OK went down on the shift key, for the hold that latches caps lock.
    ok_down: Option<std::time::Instant>,
    /// When the shift key was last pressed, for the double press that does the
    /// same. Two ways in, because a hold is easy to cut short and a double press
    /// is easy to do by accident.
    shift_tapped: Option<std::time::Instant>,
    /// Which tab is flashing, 1 for 123 and 2 for backspace.
    tab_flash: Option<(u8, std::time::Instant)>,
    wave: Wave,
    /// When the cursor last became solid. Typing restarts it, so the caret is
    /// always visible right after a key rather than possibly mid-blink.
    blink: std::time::Instant,
    /// Open with the highlighted button: 0 keeps the text, 1 discards it.
    pub discard: Option<usize>,
}

/// canvas.js drawKeyboard, the press flash on a cell.
const PRESS_MS: u128 = 100;

impl TextInput {
    pub fn new(title: &str, text: &str) -> Self {
        let grid = Grid::new(Layout::Abc);
        // Land on QWERTY, not on the number row: the numbers are the opt-in extra
        // reached with Up.
        let row = usize::from(grid.has_peek());
        Self {
            title: title.to_string(),
            text: text.to_string(),
            cursor: text.chars().count(),
            initial: text.to_string(),
            layout: Layout::Abc,
            grid,
            row,
            col: 0,
            shift: Shift::Off,
            focus: Focus::Keys,
            pressed: None,
            ok_down: None,
            shift_tapped: None,
            tab_flash: None,
            wave: Wave { rest_center: 0.0, rest_amp: 0.0, anim: None },
            blink: std::time::Instant::now(),
            discard: None,
        }
    }

    pub fn changed(&self) -> bool {
        self.text != self.initial
    }

    /// True while the wave or a press flash still needs frames.
    pub fn animating(&mut self) -> bool {
        let flashing = self
            .pressed
            .is_some_and(|(_, _, at)| at.elapsed().as_millis() < PRESS_MS);
        if !flashing {
            self.pressed = None;
        }
        let tab = self.tab_pressed() != 0;
        self.wave.running() || flashing || tab
    }

    /// Which tab is drawn pressed, 0 for neither.
    pub fn tab_pressed(&self) -> i32 {
        match self.tab_flash {
            Some((which, at))
                if at.elapsed().as_millis()
                    < u128::from(crate::theme::timing::PRESS_FLASH_MS as u32) =>
            {
                i32::from(which)
            }
            _ => 0,
        }
    }

    /// Which tab has the focus ring, 0 for neither.
    pub fn tab_focus(&self) -> i32 {
        match self.focus {
            Focus::Tab123 => 1,
            Focus::TabBackspace => 2,
            _ => 0,
        }
    }

    fn cell(&self, row: usize, col: usize) -> Option<&Cell> {
        self.grid.rows.get(row).and_then(|r| r.get(col))
    }

    fn set_layout(&mut self, layout: Layout) {
        self.layout = layout;
        self.grid = Grid::new(layout);
        self.row = self.row.min(self.grid.rows.len().saturating_sub(1));
        self.col = self
            .col
            .min(self.grid.rows.get(self.row).map_or(1, Vec::len).saturating_sub(1));
        let on_peek = self.on_peek();
        self.wave.snap(on_peek, self.col);
    }

    fn on_peek(&self) -> bool {
        self.grid.has_peek() && self.focus == Focus::Keys && self.row == 0
    }

    fn move_to(&mut self, row: usize, col: usize) {
        self.row = row;
        self.col = col;
        let on_peek = self.on_peek();
        self.wave.drive(on_peek, col);
    }

    /// Snap to `row`, keeping the column visually where it was.
    fn snap_to_row(&mut self, row: usize) {
        let target = row.min(self.grid.rows.len().saturating_sub(1));
        let x = self.grid.cell_center_2x(self.row, self.col);
        let col = self.grid.closest_col(target, x);
        self.move_to(target, col);
    }

    /// Whether the caret is solid this instant.
    pub fn cursor_visible(&self) -> bool {
        let period = u128::from(crate::theme::timing::CURSOR_BLINK_MS as u32);
        (self.blink.elapsed().as_millis() / period).is_multiple_of(2)
    }

    fn insert(&mut self, s: &str) {
        let at = self
            .text
            .char_indices()
            .nth(self.cursor)
            .map_or(self.text.len(), |(i, _)| i);
        self.text.insert_str(at, s);
        self.cursor += s.chars().count();
        self.blink = std::time::Instant::now();
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let Some((at, ch)) = self.text.char_indices().nth(self.cursor - 1) else {
            return;
        };
        self.text.replace_range(at..at + ch.len_utf8(), "");
        self.cursor -= 1;
        self.blink = std::time::Instant::now();
    }

    /// Press the highlighted key.
    fn activate(&mut self) {
        self.pressed = Some((self.row, self.col, std::time::Instant::now()));
        let Some(cell) = self.cell(self.row, self.col).cloned() else {
            return;
        };
        match cell.kind {
            Kind::Shift => {
                let hold = std::time::Duration::from_millis(u64::from(
                    crate::theme::timing::KB_DOUBLE_MS as u32,
                ));
                let doubled = self.shift_tapped.is_some_and(|at| at.elapsed() <= hold);
                self.shift_tapped = Some(std::time::Instant::now());
                self.ok_down = Some(std::time::Instant::now());
                self.shift = if doubled {
                    // A second press in quick succession means caps lock, whatever
                    // the first one left behind.
                    Shift::Caps
                } else if self.shift == Shift::Off {
                    Shift::Once
                } else {
                    Shift::Off
                };
            }
            Kind::Lang | Kind::NavUp | Kind::NavDown => {}
            Kind::Backspace => self.backspace(),
            Kind::SwitchSym => {
                let next = if self.layout == Layout::Sym { Layout::Sym2 } else { Layout::Sym };
                self.set_layout(next);
            }
            Kind::Space => self.insert(" "),
            Kind::Char => {
                let text = if self.shift == Shift::Off {
                    cell.text.to_string()
                } else {
                    cell.text.to_uppercase()
                };
                self.insert(&text);
                // One-shot shift releases after the letter it capitalised.
                if self.shift == Shift::Once {
                    self.shift = Shift::Off;
                }
            }
        }
    }

    /// Which tab a column sits over, for stepping down off the bottom row.
    fn tab_for_col(&self, col: usize) -> Option<Focus> {
        let x = self.grid.cell_x(self.row, col) + keyboard_x(&self.grid);
        let left = metric::KB_TAB_INSET;
        let right = crate::theme::PANEL_W as i32 - metric::KB_TAB_INSET - metric::KB_TAB_W;
        if x < left + metric::KB_TAB_W {
            Some(Focus::Tab123)
        } else if x + metric::KB_BTN_W > right {
            Some(Focus::TabBackspace)
        } else {
            None
        }
    }

    /// Handle a key. `valid` is the caller's verdict on the current text; Done is
    /// refused while it is false, exactly as the disabled button refuses a press.
    pub fn key(&mut self, key: FlipperKey, valid: bool) -> Option<Exit> {
        if let Some(at) = self.discard {
            match key {
                FlipperKey::Escape | FlipperKey::Back => self.discard = None,
                FlipperKey::Up | FlipperKey::Down | FlipperKey::Left | FlipperKey::Right => {
                    self.discard = Some(1 - at);
                }
                FlipperKey::Ok => {
                    self.discard = None;
                    if at == 1 {
                        return Some(Exit::Cancel);
                    }
                }
                _ => {}
            }
            return None;
        }

        // Leaving with unsaved text asks first. Leaving an unchanged field cannot
        // lose anything, so it just leaves.
        if matches!(key, FlipperKey::Escape | FlipperKey::Back) && self.changed() {
            self.discard = Some(0);
            return None;
        }
        match key {
            FlipperKey::Back | FlipperKey::Escape => return Some(Exit::Cancel),
            FlipperKey::Run => {
                return if valid { Some(Exit::Save(self.text.clone())) } else { None };
            }
            // The two tabs sit over their own keys, as in the prototype: 123 on
            // X and backspace on V. Both flash the tab they belong to.
            FlipperKey::View => {
                let next = if self.layout == Layout::Abc { Layout::Sym } else { Layout::Abc };
                self.set_layout(next);
                self.tab_flash = Some((1, std::time::Instant::now()));
                return None;
            }
            FlipperKey::Edit => {
                self.backspace();
                self.tab_flash = Some((2, std::time::Instant::now()));
                return None;
            }
            _ => {}
        }

        match self.focus {
            Focus::Field => match key {
                FlipperKey::Left => {
                    self.cursor = self.cursor.saturating_sub(1);
                    self.blink = std::time::Instant::now();
                }
                FlipperKey::Right => {
                    self.cursor = (self.cursor + 1).min(self.text.chars().count());
                    self.blink = std::time::Instant::now();
                }
                FlipperKey::Down => {
                    self.focus = Focus::Keys;
                    self.snap_to_row(0);
                }
                _ => {}
            },
            Focus::Tab123 | Focus::TabBackspace => match key {
                FlipperKey::Up => {
                    self.focus = Focus::Keys;
                    let on_peek = self.on_peek();
                    self.wave.drive(on_peek, self.col);
                }
                FlipperKey::Down => {
                    self.focus = Focus::Keys;
                    self.snap_to_row(0);
                }
                FlipperKey::Ok => {
                    if self.focus == Focus::Tab123 {
                        let next =
                            if self.layout == Layout::Abc { Layout::Sym } else { Layout::Abc };
                        self.set_layout(next);
                        self.tab_flash = Some((1, std::time::Instant::now()));
                    } else {
                        self.backspace();
                        self.tab_flash = Some((2, std::time::Instant::now()));
                    }
                }
                _ => {}
            },
            Focus::Keys => {
                let len = self.grid.rows.get(self.row).map_or(1, Vec::len).max(1);
                match key {
                    FlipperKey::Left => self.move_to(self.row, (self.col + len - 1) % len),
                    FlipperKey::Right => self.move_to(self.row, (self.col + 1) % len),
                    FlipperKey::Up => {
                        if self.row == 0 {
                            // Nothing above the top row but the field.
                            self.focus = Focus::Field;
                            self.cursor = self.text.chars().count();
                            self.wave.drive(false, self.col);
                        } else {
                            let x = self.grid.cell_center_2x(self.row, self.col);
                            let row = self.row - 1;
                            self.move_to(row, self.grid.closest_col(row, x));
                        }
                    }
                    FlipperKey::Down => {
                        let last = self.grid.rows.len().saturating_sub(1);
                        if self.row == last {
                            match self.tab_for_col(self.col) {
                                Some(tab) => {
                                    self.focus = tab;
                                    self.wave.drive(false, self.col);
                                }
                                None => {
                                    let x = self.grid.cell_center_2x(self.row, self.col);
                                    self.move_to(0, self.grid.closest_col(0, x));
                                }
                            }
                        } else {
                            let x = self.grid.cell_center_2x(self.row, self.col);
                            let row = self.row + 1;
                            self.move_to(row, self.grid.closest_col(row, x));
                        }
                    }
                    FlipperKey::Ok => self.activate(),
                    _ => {}
                }
            }
        }
        None
    }

    /// A key was let go. Returns whether anything changed.
    ///
    /// Holding OK on the shift key latches caps lock, the way the prototype's
    /// document-level keyup listener does. The tap has already toggled shift by
    /// then, which the latch overrides.
    pub fn release(&mut self, key: FlipperKey) -> bool {
        if key != FlipperKey::Ok {
            return false;
        }
        let Some(at) = self.ok_down.take() else {
            return false;
        };
        let hold = std::time::Duration::from_millis(u64::from(
            crate::theme::timing::KB_CAPS_HOLD_MS as u32,
        ));
        if at.elapsed() >= hold && self.shift != Shift::Caps {
            self.shift = Shift::Caps;
            return true;
        }
        false
    }

    /// Latch caps lock, which a long press on the shift key does.
    pub fn latch_caps(&mut self) {
        self.shift = Shift::Caps;
    }

    /// True while the highlight sits on the shift key, which is the only place a
    /// long press means anything.
    pub fn on_shift(&self) -> bool {
        self.focus == Focus::Keys
            && self.cell(self.row, self.col).is_some_and(|c| c.kind == Kind::Shift)
    }

    /// Every cell, placed. The number row is placed by the wave.
    pub fn placed(&self) -> Vec<Placed> {
        let (center, amp) = self.wave.eval();
        let kx = keyboard_x(&self.grid);
        let ky = metric::KB_CONTAINER_Y + metric::KB_INNER_Y;
        let peek_offset = i32::from(self.grid.has_peek());
        let popped = ky - metric::KB_BTN_H;
        let folded = ky - metric::KB_PEEK_VISIBLE - metric::KB_PEEK_FOLD_LIFT;
        let lift_range = (folded - popped) as f32;

        let mut out = Vec::new();
        for (r, row) in self.grid.rows.iter().enumerate() {
            let mut x = kx + self.grid.left_offset(r);
            for (c, cell) in row.iter().enumerate() {
                let is_peek = self.grid.has_peek() && r == 0;
                let (y, clip_h) = if is_peek {
                    let dist = (c as f32 - center).abs();
                    let raw = (lift_range - dist * metric::KB_PEEK_FALLOFF as f32).max(0.0);
                    let y = folded - (amp * raw).round() as i32;
                    // Anything at or below the QWERTY row's top edge is hidden by
                    // it, so the digit fades out as its card sinks.
                    (y, (ky - 1 - y).max(0))
                } else {
                    (ky + (r as i32 - peek_offset) * metric::KB_BTN_H, metric::KB_BTN_H)
                };
                let (icon, icon_w, icon_h) = self.icon_of(cell.kind);
                out.push(Placed {
                    x,
                    y,
                    w: cell.width(),
                    text: self.display_text(cell),
                    kind: cell.kind,
                    icon,
                    icon_w,
                    icon_h,
                    selected: self.focus == Focus::Keys && r == self.row && c == self.col,
                    pressed: self.pressed.is_some_and(|(pr, pc, _)| pr == r && pc == c),
                    clip_h,
                });
                x += cell.width();
            }
        }
        out
    }

    /// What a cell shows, which is the shift state applied to a letter.
    fn display_text(&self, cell: &Cell) -> String {
        if self.shift != Shift::Off && cell.kind == Kind::Char && cell.text.len() == 1 {
            cell.text.to_uppercase()
        } else {
            cell.text.to_string()
        }
    }

    /// Which icon a cell carries: 0 none, 1 shift, 2 shift held, 3 caps, 4 lang,
    /// 5 up, 6 down, 7 the space bar rule.
    fn icon_of(&self, kind: Kind) -> (i32, i32, i32) {
        match kind {
            Kind::Shift => (self.shift_icon(), 9, 9),
            Kind::Lang => (4, 11, 11),
            Kind::NavUp => (5, 8, 4),
            Kind::NavDown => (6, 8, 4),
            Kind::Space => (7, 0, 0),
            Kind::Backspace => (8, 15, 7),
            Kind::Char | Kind::SwitchSym => (0, 0, 0),
        }
    }

    /// Which shift icon the shift key carries.
    pub fn shift_icon(&self) -> i32 {
        match self.shift {
            Shift::Off => 1,
            Shift::Once => 2,
            Shift::Caps => 3,
        }
    }

    /// The chrome's own box, for the background the cells sit on.
    pub fn chrome(&self) -> (i32, i32, i32, i32) {
        (
            keyboard_x(&self.grid),
            metric::KB_CONTAINER_Y + metric::KB_INNER_Y,
            self.grid.width(),
            self.grid.chrome_rows() * metric::KB_BTN_H,
        )
    }
}

/// The keyboard's left edge: the chrome centred inside the container.
fn keyboard_x(grid: &Grid) -> i32 {
    container_x() + (metric::KB_CONTAINER_W - grid.width()) / 2
}

/// The container's left edge, centred on the panel.
pub fn container_x() -> i32 {
    (crate::theme::PANEL_W as i32 - metric::KB_CONTAINER_W) / 2
}

/// The field, sized to its text between the two caps.
pub fn field_w(text_w: i32) -> i32 {
    (text_w + 2 * metric::KB_INPUT_PAD).clamp(metric::KB_INPUT_MIN_W, metric::KB_INPUT_MAX_W)
}


/// What of the text fits in the field, and where the caret lands.
pub struct Fitted {
    /// The string to draw, markers included.
    pub visible: String,
    /// The caret’s x offset from the text’s own left edge.
    pub cursor_dx: i32,
}

const LEFT_MARKER: &str = "<...";
const RIGHT_MARKER: &str = "...>";

/// Window the text so the caret stays visible, marking each truncated side.
///
/// Widths are always measured on the rendered substring, markers attached: the
/// font’s advance table drops one unit off the tail of a run, so per-character
/// widths cannot be summed without under-counting the concatenation.
pub fn fit_input(text: &str, cursor: usize, inner_w: i32) -> Fitted {
    let font = &crate::font::TITLE;
    let chars: Vec<char> = text.chars().collect();
    let slice = |a: usize, b: usize| chars[a..b].iter().collect::<String>();
    let width = |s: &str| i32::from(font.text_width(s));
    let fits = |a: usize, b: usize, left: bool, right: bool| {
        let mut s = String::new();
        if left {
            s.push_str(LEFT_MARKER);
        }
        s.push_str(&slice(a, b));
        if right {
            s.push_str(RIGHT_MARKER);
        }
        width(&s) <= inner_w
    };
    let out = |a: usize, b: usize, left: bool, right: bool| {
        let mut visible = String::new();
        if left {
            visible.push_str(LEFT_MARKER);
        }
        visible.push_str(&slice(a, b));
        if right {
            visible.push_str(RIGHT_MARKER);
        }
        let lead = if left { width(LEFT_MARKER) } else { 0 };
        Fitted {
            visible,
            cursor_dx: lead + width(&slice(a, cursor.clamp(a, b))) + 1,
        }
    };

    if width(text) <= inner_w {
        return out(0, chars.len(), false, false);
    }
    // The longest prefix that fits with a right marker.
    let mut left_end = 0;
    for i in 1..=chars.len() {
        if !fits(0, i, false, true) {
            break;
        }
        left_end = i;
    }
    if cursor <= left_end {
        return out(0, left_end, false, true);
    }
    // The shortest suffix that fits with a left marker.
    let mut right_start = chars.len();
    for j in (0..chars.len()).rev() {
        if !fits(j, chars.len(), true, false) {
            break;
        }
        right_start = j;
    }
    if cursor >= right_start {
        return out(right_start, chars.len(), true, false);
    }
    // Both sides: grow outward from the caret.
    let (mut a, mut b) = (cursor, cursor);
    loop {
        let mut grew = false;
        if a > 0 && fits(a - 1, b, true, true) {
            a -= 1;
            grew = true;
        }
        if b < chars.len() && fits(a, b + 1, true, true) {
            b += 1;
            grew = true;
        }
        if !grew {
            break;
        }
    }
    out(a, b, true, true)
}
