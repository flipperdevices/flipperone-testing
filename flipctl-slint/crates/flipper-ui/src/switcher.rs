//! The app switcher: a stack of cards, one per running app.
//!
//! Ported from `running_apps.js` and `app_switcher.js`. Cards live in integer
//! slots, most-recent at 0 and older ones negative, and every visual state is a
//! lerp between two of the slot frames below and the off-screen anchors beside
//! them. The arithmetic and the phase machine are here; the drawing is in
//! ui/switcher.slint, which is handed placed cards and never decides anything.
//!
//! The frames stay in this file rather than in tokens.toml: they are a table of
//! rectangles, which that file has no shape for, and every one of them is
//! asserted against the prototype in tests/switcher.rs.
//!
//! The frames, the durations and the z-order are the prototype's. What is left
//! out is its touchpad drag and its haptics, neither of which has a source or a
//! sink here, and its wrap hint: `_raiseWrapHint` and `_wrapToTop` are defined
//! there but never called, and the ghost card they spawn is filtered by a branch
//! that cannot run. Bounded navigation with a tug at each end replaced it.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::key::FlipperKey;

/// One card frame: a rectangle with a radius per corner, because the tabs are
/// square where they meet the card above them.
#[derive(Copy, Clone, PartialEq, Debug, Default)]
pub struct State {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub r_tl: i32,
    pub r_tr: i32,
    pub r_bl: i32,
    pub r_br: i32,
}

/// A frame, with the four corner radii as one argument: clockwise from top-left.
const fn frame(x: i32, y: i32, w: i32, h: i32, r: (i32, i32, i32, i32)) -> State {
    State { x, y, w, h, r_tl: r.0, r_tr: r.1, r_bl: r.2, r_br: r.3 }
}

/// The panel, as numbers this module can do arithmetic with.
const W: i32 = crate::theme::PANEL_W as i32;
const H: i32 = crate::theme::PANEL_H as i32;
/// A card is two pixels wider than the panel: its right edge runs off the screen,
/// which is what makes it read as a window onto an app rather than a box.
const CARD_W: i32 = W + 2;

/// The deck's vertical split.
///
/// The Kill button sits on the bottom row, so the cards get everything above it:
/// a strip that ran under the button would put a card's name behind it.
///
/// The focused card takes 55% of the panel and the background cards share the
/// rest, a strip each: 32 pixels with one card either side, 21 when there are two
/// below. More cards below tighten every strip toward `STRIP_MIN`, which has to
/// clear the name bar with room to spare: a card's picture is drawn panel-sized
/// and cropped, so what is left under the bar is all of the app that can be seen.
const STRIP_MIN: i32 = BAR_H + 6;
const FOCUS_H: i32 = H * 55 / 100;
/// The panel less the soft-button row.
const AREA: i32 = H - crate::theme::metric::BUTTON_H;
/// How many cards below the focus have geometry: a fourth strip would fall under
/// the floor.
const BELOW_MAX: i32 = 2;
/// A card is inset from the left, except the focused one, which is flush.
const INSET_X: i32 = 12;
const INSET_W: i32 = 252;
/// Every corner of every card, now that none of them is a tab.
const R: (i32, i32, i32, i32) = (4, 4, 4, 4);

/// The heights the deck is drawn at, for a given number of neighbours.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Deck {
    /// A background card's visible strip.
    pub strip: i32,
    above: i32,
    below: i32,
}

impl Deck {
    pub fn new(above: i32, below: i32) -> Self {
        let below = below.clamp(0, BELOW_MAX);
        // An empty slot keeps its strip, so the focused card stays where it is
        // whether or not there is a card behind it to show through.
        let n = 1 + below.max(1);
        let strip = ((AREA - FOCUS_H) / n).max(STRIP_MIN);
        Self { strip, above: above.min(1), below }
    }

    /// The focused card: whatever the strips leave, which is 55% of the panel with
    /// one card either side and less when the deck is deeper than that.
    pub fn focused(&self) -> State {
        frame(2, self.strip, CARD_W, AREA - (1 + self.below.max(1)) * self.strip, R)
    }

    /// The frame for an integer slot, if the deck has one.
    ///
    /// The right edge of every one of these runs past the panel, which is
    /// deliberate: a card is a window onto an app, not a box centred on the
    /// screen. A card above is as tall as the focused card and hides under it,
    /// and the lowest one runs to the bottom edge, so only the strips show.
    pub fn slot(&self, position: i32) -> Option<State> {
        let f = self.focused();
        match position {
            1 if self.above >= 1 => Some(frame(INSET_X, 1, INSET_W, f.h, R)),
            0 => Some(f),
            -1 if self.below >= 1 => {
                let y = f.y + f.h;
                let h = if self.below >= 2 { self.strip } else { AREA - y };
                Some(frame(INSET_X, y, INSET_W, h, R))
            }
            -2 if self.below >= 2 => {
                let y = f.y + f.h + self.strip;
                Some(frame(INSET_X, y, INSET_W, AREA - y, R))
            }
            _ => None,
        }
    }

    /// Off the left edge, where a killed card goes.
    fn killed(&self) -> State {
        State { x: -W - 4, ..self.focused() }
    }

    /// The focused frame, one panel height down: the previous app rises from here
    /// as the switcher opens.
    fn intro_from_bottom(&self) -> State {
        State { y: H, ..self.focused() }
    }
}

/// Full-canvas overscan, square cornered: what the focused card zooms out of when
/// the switcher opens and back into when it launches an app.
const FULL: State = frame(-1, -1, CARD_W, H + 2, (0, 0, 0, 0));

/// The frame for an integer slot in the nominal deck: one card either side of
/// the focus, so a quarter, a half and a quarter.
pub fn slot(position: i32) -> Option<State> {
    Deck::new(1, 1).slot(position)
}

/// One transition. Every phase runs this long except the opener, which takes
/// twice as long so it reads as an opener rather than a scroll step.
const ANIM_MS: f32 = 110.0;
/// How far the focused card is tugged when there is nothing past it.
const BOUNCE_PX: f32 = 5.0;
/// How far the image sits above the frame's interior top, so the source app's
/// own status bar is cropped away rather than showing under the title bar.
const IMG_LIFT: i32 = 13;
/// The same offset expressed against a slot's own y, for the zoom transitions.
const IMG_LIFT_ZOOM: i32 = 12;
/// The image's left edge in the focused frame.
const IMG_X: i32 = 2;
/// A background card's name bar, and the one a card off the deck draws as it
/// fades. The focused card's is taller.
pub const BAR_H: i32 = 14;
pub const BAR_H_FOCUSED: i32 = 16;

fn ease_out_cubic(t: f32) -> f32 {
    1.0 - (1.0 - t).powi(3)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Lerp two frames, rounding the four edges rather than x and w.
///
/// Rounding a position and a size separately puts their rounding errors out of
/// phase, and the visible edge then jitters by a pixel while the lerp underneath
/// is perfectly monotonic.
pub fn lerp_state(a: State, b: State, t: f32) -> State {
    let l = lerp(a.x as f32, b.x as f32, t).round();
    let r = lerp((a.x + a.w) as f32, (b.x + b.w) as f32, t).round();
    let top = lerp(a.y as f32, b.y as f32, t).round();
    let bottom = lerp((a.y + a.h) as f32, (b.y + b.h) as f32, t).round();
    State {
        x: l as i32,
        y: top as i32,
        w: (r - l) as i32,
        h: (bottom - top) as i32,
        r_tl: lerp(a.r_tl as f32, b.r_tl as f32, t).round() as i32,
        r_tr: lerp(a.r_tr as f32, b.r_tr as f32, t).round() as i32,
        r_bl: lerp(a.r_bl as f32, b.r_bl as f32, t).round() as i32,
        r_br: lerp(a.r_br as f32, b.r_br as f32, t).round() as i32,
    }
}

/// A screen as the user last saw it: panel-sized 8-bit greyscale.
///
/// Shared rather than copied: the same bytes are handed to the renderer on every
/// frame of an animation, and a card that is never touched again keeps its
/// thumbnail alive for as long as the app is in the list.
pub type Snapshot = Arc<Vec<u8>>;

/// What a card stands for.
///
/// Settings and Network are cards too, which is what the prototype does with the
/// submenus it marks as apps: from the switcher's side they are things the user
/// was doing and can go back to, and the only difference is that going back to one
/// is a navigation rather than a process gaining focus.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Kind {
    #[default]
    App,
    Screen,
}

/// One thing the user was doing, in the order they last did it.
#[derive(Clone, Debug, Default)]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
    pub snapshot: Option<Snapshot>,
}

/// The recents stack: most-recently-used first.
#[derive(Debug, Default)]
pub struct Recents {
    apps: Vec<Entry>,
}

impl Recents {
    /// Add an app, or bump it to the front if it is already here.
    ///
    /// A relaunch keeps whatever thumbnail the entry had: the app is about to draw
    /// its own screen anyway, and the switcher should go on showing the last view
    /// of it until then.
    pub fn open(&mut self, name: &str, kind: Kind) {
        if let Some(at) = self.apps.iter().position(|a| a.name == name) {
            let mut entry = self.apps.remove(at);
            entry.kind = kind;
            self.apps.insert(0, entry);
            return;
        }
        self.apps.insert(0, Entry { name: name.to_string(), kind, snapshot: None });
    }

    /// What a name stands for, if it is in the stack at all.
    pub fn kind(&self, name: &str) -> Option<Kind> {
        self.apps.iter().find(|a| a.name == name).map(|a| a.kind)
    }

    /// Remember what an app looked like when the user left it.
    pub fn snapshot(&mut self, name: &str, image: Snapshot) {
        if let Some(entry) = self.apps.iter_mut().find(|a| a.name == name) {
            entry.snapshot = Some(image);
        }
    }

    pub fn close(&mut self, name: &str) {
        self.apps.retain(|a| a.name != name);
    }

    /// The last frame captured for an app, if there is one.
    ///
    /// The card's picture, borrowed for a second purpose: putting an app back on the
    /// panel when it comes forward again, so what appears is that app's own last
    /// screen rather than whatever the framebuffer happened to hold.
    pub fn frame_of(&self, name: &str) -> Option<Snapshot> {
        self.apps
            .iter()
            .find(|a| a.name == name)
            .and_then(|a| a.snapshot.clone())
    }

    pub fn list(&self) -> &[Entry] {
        &self.apps
    }

    pub fn len(&self) -> usize {
        self.apps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.apps.is_empty()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Phase {
    /// The lone card zooming out of the full screen.
    Opening,
    Rest,
    /// Cards moving between slots, which is also how the opener runs.
    Scrolling,
    /// The focused card sliding off the left edge.
    Killing,
    /// The focused card zooming back to full screen, after which its app takes
    /// over the display.
    Closing,
    /// A tug at either end of the stack.
    Bouncing,
}

/// One card in the stack.
#[derive(Clone, Debug, Default)]
pub struct Card {
    pub name: String,
    pub kind: Kind,
    pub snapshot: Option<Snapshot>,
    /// The slot it is in, or heading for.
    pub position: i32,
    /// Where it came from, when it is moving.
    pub anim_from: Option<i32>,
    /// An off-slot anchor to move from or to, for the opener and the wrap hint.
    from_state: Option<State>,
    to_state: Option<State>,
    killing: bool,
    /// Drawn above everything else, which is what the previous app does as it
    /// rises into focus past the outgoing one.
    overlay: bool,
    /// Its image starts as the whole screen rather than inside a frame.
    image_from_full: bool,
    hidden: bool,
}

/// What the switcher asks the caller to do.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Action {
    /// Leave the switcher, staying where the user was.
    Close,
    /// Go back to this card: an app gains focus, one of our screens is navigated
    /// to.
    Launch(String, Kind),
    /// End this card: an app is stopped, a screen just leaves the stack.
    Kill(String, Kind),
}

pub struct Switcher {
    pub cards: Vec<Card>,
    pub focused: usize,
    phase: Phase,
    started: Instant,
    duration: f32,
    /// Set when a press could not be honoured, so the bounce knows which way to
    /// tug: +1 for a Down at the oldest, -1 for an Up at the most recent.
    bounce_dir: i32,
}

impl Switcher {
    /// The card the deck is showing, which is the only one worth photographing.
    pub fn focused_name(&self) -> Option<&str> {
        self.cards.get(self.focused).map(|c| c.name.as_str())
    }

    /// Copy the newest pictures onto the cards of a deck that is already open.
    ///
    /// `open` takes a snapshot of the snapshots, which is right for the animation and
    /// wrong for a running app: its picture goes on changing while the deck is being
    /// looked at, so a card would keep the frame it had when the deck opened.
    pub fn refresh_from(&mut self, recents: &Recents) -> bool {
        let mut changed = false;
        for card in self.cards.iter_mut() {
            let Some(entry) = recents.list().iter().find(|a| a.name == card.name) else {
                continue;
            };
            // Identity, not contents: `!=` on two `Arc<Vec<u8>>` compares 36KB a card
            // a tick to answer a question a pointer answers.
            let moved = match (card.snapshot.as_ref(), entry.snapshot.as_ref()) {
                (_, None) => false,
                (None, Some(_)) => true,
                (Some(shown), Some(newest)) => !Arc::ptr_eq(shown, newest),
            };
            if moved {
                card.snapshot = entry.snapshot.clone();
                changed = true;
            }
        }
        changed
    }

    /// Open over `recents`.
    ///
    /// `on_top_card` says whether what the user is looking at right now is itself
    /// the top of the stack. If it is, the focus starts one below, so Tab twice is
    /// "back to what I was doing before this": the current card shrinks into the
    /// peek slot while the previous one rises into focus. From anywhere else the
    /// focus starts on the most recent card and it zooms out of the screen.
    pub fn open(recents: &Recents, on_top_card: bool) -> Self {
        let mut cards: Vec<Card> = Vec::new();
        for entry in recents.list() {
            cards.push(Card {
                name: entry.name.clone(),
                kind: entry.kind,
                snapshot: entry.snapshot.clone(),
                ..Card::default()
            });
        }

        let mut switcher = Self {
            cards,
            focused: 0,
            phase: Phase::Opening,
            started: Instant::now(),
            duration: ANIM_MS,
            bounce_dir: 0,
        };

        if on_top_card && switcher.cards.len() >= 2 {
            switcher.focused = 1;
            switcher.phase = Phase::Scrolling;
            switcher.duration = ANIM_MS * 2.0;

            let n = switcher.cards.len();
            for i in 2..n {
                switcher.cards[i].anim_from = None;
                switcher.cards[i].position = linear_position(i, 1);
            }
            let deck = Deck::new(1, n as i32 - 2);

            let a = &mut switcher.cards[0];
            a.anim_from = Some(0);
            a.position = 1;
            a.from_state = Some(FULL);
            a.to_state = deck.slot(1);
            a.image_from_full = true;

            let b = &mut switcher.cards[1];
            b.anim_from = Some(0);
            b.position = 0;
            b.from_state = Some(deck.intro_from_bottom());
            b.to_state = Some(deck.focused());
            b.overlay = true;
        }
        switcher
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }

    /// How far through the current phase, eased.
    fn eased(&self) -> f32 {
        let t = (self.started.elapsed().as_secs_f32() * 1000.0 / self.duration).clamp(0.0, 1.0);
        ease_out_cubic(t)
    }

    fn done(&self) -> bool {
        self.started.elapsed().as_secs_f32() * 1000.0 >= self.duration
    }

    /// True while frames are still needed.
    pub fn animating(&self) -> bool {
        self.phase != Phase::Rest
    }

    /// Advance the phase machine. Returns an action when an animation has
    /// finished and the caller has to act on it, which is how a launch waits for
    /// the zoom to land.
    pub fn tick(&mut self) -> Option<Action> {
        if self.phase == Phase::Rest || !self.done() {
            return None;
        }
        match self.phase {
            Phase::Closing => {
                let card = self.focused_card().map(|c| (c.name.clone(), c.kind));
                self.phase = Phase::Rest;
                return card.map(|(name, kind)| Action::Launch(name, kind));
            }
            Phase::Killing => {
                self.cards.retain(|c| !c.killing);
                self.settle();
                if self.cards.is_empty() {
                    return Some(Action::Close);
                }
            }
            Phase::Bouncing => {
                self.bounce_dir = 0;
                self.phase = Phase::Rest;
            }
            _ => {
                // The opener and every scroll land the same way: the cards are
                // where they were heading, and the one-shot flags that drove the
                // transition are spent.
                self.settle();
            }
        }
        None
    }

    /// Park every card at its slot with no animation left to play.
    fn settle(&mut self) {
        self.focused = self.focused.min(self.cards.len().saturating_sub(1));
        self.duration = ANIM_MS;
        for (i, card) in self.cards.iter_mut().enumerate() {
            card.position = linear_position(i, 0);
            card.anim_from = None;
            card.from_state = None;
            card.to_state = None;
            card.overlay = false;
            card.image_from_full = false;
            card.hidden = false;
        }
        let focused = self.focused;
        for (i, card) in self.cards.iter_mut().enumerate() {
            card.position = linear_position(i, focused);
        }
        self.phase = Phase::Rest;
    }

    fn focused_card(&self) -> Option<&Card> {
        self.cards.iter().find(|c| c.position == 0 && !c.killing)
    }

    /// Move the focus, or tug the stack when there is nowhere to go.
    fn step(&mut self, delta: i32) {
        let n = self.cards.len() as i32;
        if n == 0 {
            return;
        }
        let next = self.focused as i32 + delta;
        if next < 0 || next >= n {
            self.bounce_dir = delta;
            self.phase = Phase::Bouncing;
            self.duration = ANIM_MS;
            self.started = Instant::now();
            return;
        }
        self.focused = next as usize;
        let focused = self.focused;
        for (i, card) in self.cards.iter_mut().enumerate() {
            card.anim_from = Some(card.position);
            card.position = linear_position(i, focused);
            card.from_state = None;
            card.to_state = None;
            card.hidden = false;
            card.overlay = false;
            card.image_from_full = false;
        }
        self.phase = Phase::Scrolling;
        self.duration = ANIM_MS;
        self.started = Instant::now();
    }

    /// Start the kill slide on the focused card.
    fn kill_focused(&mut self) -> Option<Action> {
        let at = self.cards.iter().position(|c| c.position == 0)?;
        let name = self.cards[at].name.clone();
        let kind = self.cards[at].kind;
        self.cards[at].killing = true;
        // The focus moves to whatever comes after the killed card, or back to the
        // most recent when the oldest was killed.
        let survivors = self.cards.len() - 1;
        self.focused = if survivors == 0 {
            0
        } else if at < survivors {
            at
        } else {
            0
        };
        self.phase = Phase::Killing;
        self.duration = ANIM_MS;
        self.started = Instant::now();
        Some(Action::Kill(name, kind))
    }

    /// Handle a key.
    ///
    /// Back leaves. Escape kills the focused app, which is what the Kill button
    /// under it says, and leaves instead when the focus is the screen the user
    /// came from. OK, Run and the switcher key itself launch. Up and Down move,
    /// bounded, and only while nothing is animating: a fast double press would
    /// otherwise shift the stack twice for one visible step.
    pub fn key(&mut self, key: FlipperKey) -> Option<Action> {
        if key == FlipperKey::Back {
            return Some(Action::Close);
        }
        // Before the phase guard, so this still works while the last app's kill
        // animation is playing.
        if key == FlipperKey::Escape && self.focused_card().is_none() {
            return Some(Action::Close);
        }
        if self.phase != Phase::Rest {
            return None;
        }
        match key {
            FlipperKey::Ok | FlipperKey::Run | FlipperKey::AppSwitch => {
                self.focused_card()?;
                self.phase = Phase::Closing;
                self.duration = ANIM_MS;
                self.started = Instant::now();
                None
            }
            FlipperKey::Escape => self.kill_focused(),
            FlipperKey::Down => {
                self.step(1);
                None
            }
            FlipperKey::Up => {
                self.step(-1);
                None
            }
            _ => None,
        }
    }

    /// Drop a card whose app is gone, wherever the stack is.
    ///
    /// Not the kill slide: nothing was chosen, the process simply ended, so the
    /// card disappears and the rest close up. Returns true if it was there.
    pub fn drop_card(&mut self, name: &str) -> bool {
        let before = self.cards.len();
        self.cards.retain(|c| c.name != name);
        if self.cards.len() == before {
            return false;
        }
        self.focused = self.focused.min(self.cards.len().saturating_sub(1));
        self.settle();
        true
    }

    /// Whether the Kill button is offered: there has to be a card under the focus
    /// and it must not be the one already on its way out.
    pub fn can_kill(&self) -> bool {
        self.phase != Phase::Killing && self.focused_card().is_some()
    }

    /// Every card, placed and in drawing order.
    pub fn placed(&self) -> Vec<Placed> {
        let e = self.eased();
        let mut out: Vec<Placed> = self
            .cards
            .iter()
            .filter(|c| !c.hidden)
            .filter_map(|c| self.place(c, e))
            .collect();
        // Furthest from the focus first, so the nearest card paints last. Killed
        // and overlay cards sort to the very end: one slides over the survivors,
        // the other rises in front of the card it is replacing.
        out.sort_by(|a, b| b.z.total_cmp(&a.z));
        out
    }

    /// The deck the cards on screen add up to.
    fn deck(&self) -> Deck {
        let live = || self.cards.iter().filter(|c| !c.hidden && !c.killing);
        let above = live().any(|c| c.position >= 1) as i32;
        let below = live().filter(|c| c.position <= -1).count() as i32;
        Deck::new(above, below)
    }

    fn place(&self, card: &Card, e: f32) -> Option<Placed> {
        let deck = self.deck();
        let mut alpha = 1.0f32;
        let mut pinned: Option<f32> = None;
        if card.from_state.is_some() && card.to_state.is_none() {
            pinned = Some(card.position.abs() as f32);
            if deck.slot(card.position).is_none() {
                alpha = alpha.min(1.0 - e);
            }
        } else if let Some(from) = card.anim_from {
            match (deck.slot(from).is_some(), deck.slot(card.position).is_some()) {
                (true, false) => {
                    alpha = 1.0 - e;
                    pinned = Some(from.abs() as f32);
                }
                (false, true) => {
                    alpha = e;
                    pinned = Some(card.position.abs() as f32);
                }
                _ => {}
            }
        }
        if alpha < 0.001 {
            return None;
        }

        let state = self.state_of(card, e)?;

        // How far this card is from the focus, as the styles see it: 0 is focused
        // and 1 or more is a tab.
        let pos_abs = match (pinned, card.anim_from) {
            (Some(p), _) => p,
            (None, Some(from)) => lerp(from as f32, card.position as f32, e).abs(),
            (None, None) => card.position.abs() as f32,
        };
        let pos_clamped = pos_abs.clamp(0.0, 1.0);

        // Past the deepest strip a card has no frame of its own and draws as the
        // plain grey bar while it fades out where it stood.
        let deep = deck.slot(card.position).is_none()
            && card.anim_from.is_none_or(|f| deck.slot(f).is_none());

        // The image rides above the frame's interior top so the source's own
        // status bar is cropped rather than sitting under the title bar. During a
        // zoom it translates only, never scales: resampling a pixel screen is
        // worse than cropping it.
        let (img_x, img_y) = if card.image_from_full || matches!(self.phase, Phase::Opening | Phase::Closing) {
            let target = deck.slot(card.position).unwrap_or_else(|| deck.focused());
            let target_y = target.y - IMG_LIFT_ZOOM;
            if self.phase == Phase::Closing {
                (
                    lerp(IMG_X as f32, 0.0, e).round() as i32,
                    lerp(target_y as f32, 0.0, e).round() as i32,
                )
            } else {
                (
                    lerp(0.0, IMG_X as f32, e).round() as i32,
                    lerp(0.0, target_y as f32, e).round() as i32,
                )
            }
        } else {
            (IMG_X, state.y + 1 - IMG_LIFT)
        };

        let z = if card.killing {
            -1.0
        } else if card.overlay {
            -0.5
        } else if let Some(from) = card.anim_from {
            lerp(from as f32, card.position as f32, e).abs()
        } else {
            card.position.abs() as f32
        };

        Some(Placed {
            name: card.name.clone(),
            snapshot: card.snapshot.clone(),
            state,
            alpha,
            pos_clamped,
            // The neighbours keep their picture, at full strength. It used to fade
            // out with distance, which was right when they were tabs with a label
            // and nothing else: now that a strip of the app is the whole point of a
            // background card, fading it leaves an empty card.
            image_alpha: alpha,
            img_x,
            img_y,
            deep,
            killing: card.killing,
            z,
        })
    }

    fn state_of(&self, card: &Card, e: f32) -> Option<State> {
        let deck = self.deck();
        let focused = deck.focused();
        if card.killing {
            return Some(lerp_state(focused, deck.killed(), e));
        }
        if self.phase == Phase::Opening && card.position == 0 {
            return Some(lerp_state(FULL, focused, e));
        }
        if self.phase == Phase::Closing && card.position == 0 {
            return Some(lerp_state(focused, FULL, e));
        }
        if self.phase == Phase::Bouncing && card.position == 0 && self.bounce_dir != 0 {
            // A single pulse: out and back, peaking halfway. Down means the card
            // would have moved up, so the sign is flipped to screen coordinates.
            let t = (self.started.elapsed().as_secs_f32() * 1000.0 / self.duration).clamp(0.0, 1.0);
            let pulse = (std::f32::consts::PI * t).sin() * BOUNCE_PX;
            let dy = -(self.bounce_dir as f32) * pulse;
            return Some(State { y: focused.y + dy.round() as i32, ..focused });
        }
        if matches!(self.phase, Phase::Scrolling | Phase::Killing) && card.anim_from.is_some() {
            let from = card.from_state.or_else(|| deck.slot(card.anim_from?));
            let to = card.to_state.or_else(|| deck.slot(card.position));
            return match (from, to) {
                (Some(a), Some(b)) => Some(lerp_state(a, b, e)),
                (a, b) => b.or(a),
            };
        }
        deck.slot(card.position)
    }
}

/// A card's slot in a bounded list: the focused card is 0 and older cards go
/// negative, so the stack reads top to bottom as most recent to oldest.
fn linear_position(idx: usize, focused: usize) -> i32 {
    focused as i32 - idx as i32
}

/// A card, ready to draw.
#[derive(Clone, Debug)]
pub struct Placed {
    pub name: String,
    pub snapshot: Option<Snapshot>,
    pub state: State,
    /// The whole card's opacity, for a card fading on or off the carousel.
    pub alpha: f32,
    /// 0 focused, 1 a tab, in between while it moves. Drives the crossfade
    /// between the two styles.
    pub pos_clamped: f32,
    pub image_alpha: f32,
    pub img_x: i32,
    pub img_y: i32,
    /// Off the deck: the plain grey bar, no crossfade.
    pub deep: bool,
    pub killing: bool,
    z: f32,
}

/// How long a phase lasts, for a caller that wants to pace its own repaints.
pub fn anim_duration() -> Duration {
    Duration::from_millis(ANIM_MS as u64)
}
