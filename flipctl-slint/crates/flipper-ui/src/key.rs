//! Semantic buttons.
//!
//! The panel has a D-pad with a centre press, a back and an app-switcher key, a
//! push-to-talk key, and a bottom row of five soft keys. The bottom row reads
//! left to right on the hardware as **esc, view, power, edit, run**, which is
//! what `drivers/input/misc/flipper-one-input.c` already encodes; fake-flipctl2's
//! `input.js` calls two of them `edit` and `del` and is simply wrong.
//!
//! Keycodes come from the MCU input driver, which registers four devices. Only
//! `Flipper One Buttons` and `Flipper One Software Buttons` matter here: same
//! codes, one from the physical keys and one injected, so a remote viewer and a
//! finger are indistinguishable downstream.

/// A button, named for what it means rather than which key code carries it.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum FlipperKey {
    Up,
    Down,
    Left,
    Right,
    /// D-pad centre.
    Ok,
    Back,
    /// App switcher.
    AppSwitch,
    /// Push to talk. Held rather than tapped, so consumers want the up event.
    Ptt,
    /// Bottom row, left to right.
    Escape,
    View,
    Power,
    Edit,
    Run,
}

/// Linux keycodes, from `flipper-one-input.c`.
mod code {
    pub const KEY_UP: u16 = 103;
    pub const KEY_DOWN: u16 = 108;
    pub const KEY_LEFT: u16 = 105;
    pub const KEY_RIGHT: u16 = 106;
    pub const KEY_ENTER: u16 = 28;
    pub const KEY_BACKSPACE: u16 = 14;
    pub const KEY_TAB: u16 = 15;
    pub const KEY_A: u16 = 30;
    pub const KEY_B: u16 = 48;
    pub const KEY_C: u16 = 46;
    pub const KEY_V: u16 = 47;
    pub const KEY_X: u16 = 45;
    pub const KEY_Z: u16 = 44;
}

impl FlipperKey {
    /// Map a raw `EV_KEY` code. `None` for anything the panel UI does not own,
    /// which includes the headset keys on the third input device.
    pub fn from_evdev(keycode: u16) -> Option<Self> {
        Some(match keycode {
            code::KEY_UP => Self::Up,
            code::KEY_DOWN => Self::Down,
            code::KEY_LEFT => Self::Left,
            code::KEY_RIGHT => Self::Right,
            code::KEY_ENTER => Self::Ok,
            code::KEY_BACKSPACE => Self::Back,
            code::KEY_TAB => Self::AppSwitch,
            code::KEY_A => Self::Ptt,
            code::KEY_Z => Self::Escape,
            code::KEY_X => Self::View,
            code::KEY_C => Self::Power,
            code::KEY_V => Self::Edit,
            code::KEY_B => Self::Run,
            _ => return None,
        })
    }

    /// Stable name, used by the remote view's wire format and by test scripts.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Down => "down",
            Self::Left => "left",
            Self::Right => "right",
            Self::Ok => "ok",
            Self::Back => "back",
            Self::AppSwitch => "appsw",
            Self::Ptt => "ptt",
            Self::Escape => "esc",
            Self::View => "view",
            Self::Power => "power",
            Self::Edit => "edit",
            Self::Run => "run",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|k| k.name() == name)
    }

    pub const ALL: [FlipperKey; 13] = [
        Self::Up,
        Self::Down,
        Self::Left,
        Self::Right,
        Self::Ok,
        Self::Back,
        Self::AppSwitch,
        Self::Ptt,
        Self::Escape,
        Self::View,
        Self::Power,
        Self::Edit,
        Self::Run,
    ];

    /// The bottom soft-key row, in the order it is silkscreened.
    pub const SOFT_ROW: [FlipperKey; 5] =
        [Self::Escape, Self::View, Self::Power, Self::Edit, Self::Run];
}

/// A press or a release. Push-to-talk and the press-flash timings both need the
/// distinction, so it is carried rather than collapsed to "pressed".
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct KeyEvent {
    pub key: FlipperKey,
    pub down: bool,
}
