//! The app switcher's stack, phases and geometry.
//!
//! The frames come out of the deck's split of the panel, so they are asserted
//! literally: if a slot moves, that is a design decision and this test is where
//! it gets noticed. The rest is behaviour that cannot be seen in a screenshot, which is
//! why it is worth a test at all: what the focus does at the ends of the stack,
//! where it lands after a kill, and that a launch waits for its animation.

use std::sync::Arc;

use flipper_ui::key::FlipperKey::{AppSwitch, Back, Down, Escape, Ok, Run, Up};
use flipper_ui::switcher::{self, Action, Deck, Kind, Phase, Recents, State, Switcher};

fn recents(names: &[&str]) -> Recents {
    let mut r = Recents::default();
    // Opened oldest first, so the list ends up most-recent first.
    for name in names.iter().rev() {
        r.open(name, Kind::App);
    }
    r
}

/// Sit still until the current phase is over, then let the machine settle.
fn finish(s: &mut Switcher) -> Option<Action> {
    std::thread::sleep(std::time::Duration::from_millis(260));
    s.tick()
}

/// Let an animation get under way. Sampling at t = 0 says nothing: every lerp
/// starts exactly where it was, so an assertion about movement has to wait for
/// some of it to happen.
fn part_way() {
    std::thread::sleep(std::time::Duration::from_millis(40));
}

#[test]
fn the_stack_is_most_recently_used_first() {
    let mut r = recents(&["Ping", "Progress"]);
    assert_eq!(names(&r), ["Ping", "Progress"]);

    // Reopening moves an app to the front and keeps its thumbnail.
    r.snapshot("Progress", Arc::new(vec![0u8; 4]));
    r.open("Progress", Kind::App);
    assert_eq!(names(&r), ["Progress", "Ping"]);
    assert!(r.list()[0].snapshot.is_some(), "a relaunch keeps the last view");

    r.close("Ping");
    assert_eq!(names(&r), ["Progress"]);
}

fn names(r: &Recents) -> Vec<&str> {
    r.list().iter().map(|e| e.name.as_str()).collect()
}

/// The deck's split of the panel: 55% for the focused card, a strip each for the
/// cards either side of it, and nothing under the soft-button row. Every frame
/// runs off the right edge of the panel on purpose.
#[test]
fn the_deck_gives_the_focused_card_the_middle_half() {
    let f = |p| switcher::slot(p).expect("slot has geometry");
    assert_eq!(
        f(1),
        State { x: 12, y: 1, w: 252, h: 80, r_tl: 4, r_tr: 4, r_bl: 4, r_br: 4 },
        "a card above is as tall as the focused card and hides under it"
    );
    assert_eq!(
        f(0),
        State { x: 2, y: 25, w: 258, h: 80, r_tl: 4, r_tr: 4, r_bl: 4, r_br: 4 }
    );
    assert_eq!(
        f(-1),
        State { x: 12, y: 105, w: 252, h: 25, r_tl: 4, r_tr: 4, r_bl: 4, r_br: 4 },
        "the card below runs down to the Kill button, not past it"
    );
    assert!(switcher::slot(2).is_none(), "nothing above the peek");
    assert!(switcher::slot(-2).is_none(), "one card below, one slot below");
    assert!(switcher::slot(-3).is_none(), "nothing below the deepest strip");
}

/// More cards below tighten the strips instead of adding a sliver: the focused
/// card keeps its half and each background card keeps enough height to show a
/// piece of its app rather than a header.
#[test]
fn more_cards_tighten_the_strips_to_a_floor() {
    let two = Deck::new(1, 2);
    // The floor wins here, so the focused card gives up a few rows rather than
    // the deepest strip losing its name.
    assert_eq!(two.strip, 20, "three strips share what the focus leaves");
    assert_eq!(two.focused(), State { x: 2, y: 20, w: 258, h: 70, r_tl: 4, r_tr: 4, r_bl: 4, r_br: 4 });
    let below = two.slot(-1).expect("a strip below");
    let deepest = two.slot(-2).expect("the deepest strip");
    assert_eq!(below.y, 90);
    assert_eq!(below.h, 20);
    assert_eq!(deepest.y, 110);
    assert_eq!(deepest.y + deepest.h, 130, "the deepest one stops at the Kill button");
    assert!(two.slot(-3).is_none(), "a fourth card below would not fit");

    // Past the floor the deck stops splitting: two below is as deep as it goes.
    assert_eq!(Deck::new(1, 5), two);

    // An empty slot keeps its strip, so the focused card does not move about as
    // the stack grows and shrinks around it.
    assert_eq!(Deck::new(0, 0).focused(), switcher::slot(0).unwrap());
    assert_eq!(Deck::new(0, 1).focused(), switcher::slot(0).unwrap());
    assert!(Deck::new(0, 1).slot(1).is_none(), "no card above, no strip drawn");
}

/// A lerp rounds the four edges, not the position and the size separately.
///
/// Rounding x and w apart puts their errors out of phase, and an edge then
/// wobbles by a pixel while the underlying lerp is monotonic.
#[test]
fn a_lerp_keeps_its_edges_monotonic() {
    let a = switcher::slot(0).unwrap();
    let b = switcher::slot(-1).unwrap();
    let mut right = i32::MIN;
    let mut bottom = i32::MIN;
    for step in 0..=20 {
        let t = step as f32 / 20.0;
        let s = switcher::lerp_state(a, b, t);
        // The right edge travels from 260 to 264 and never backwards.
        assert!(s.x + s.w >= right, "right edge went backwards at t={t}");
        assert!(s.y + s.h >= bottom, "bottom edge went backwards at t={t}");
        right = s.x + s.w;
        bottom = s.y + s.h;
    }
    assert_eq!(switcher::lerp_state(a, b, 0.0), a);
    assert_eq!(switcher::lerp_state(a, b, 1.0), b);
}

/// Opening on two or more cards plays the opener: what the user came from shrinks
/// into the peek slot while the previous app rises from below into focus.
#[test]
fn opening_lands_on_the_previous_app() {
    let r = recents(&["Ping", "Progress", "Speed Test"]);
    let mut s = Switcher::open(&r, true);

    assert_eq!(s.phase(), Phase::Scrolling);
    assert_eq!(s.focused, 1, "the previous app, not the one just left");
    assert_eq!(s.cards[0].position, 1, "the current app shrinks to the peek");
    assert_eq!(s.cards[1].position, 0);
    assert_eq!(s.cards[2].position, -1);

    // Mid-opener the incoming card is somewhere between the bottom of the panel
    // and the focused slot, and it is drawn last so it rises in front.
    let placed = s.placed();
    let incoming = placed.last().expect("something is drawn");
    assert_eq!(incoming.name, "Progress");
    assert!(
        incoming.state.y > switcher::slot(0).unwrap().y,
        "the incoming card should still be below its slot"
    );

    finish(&mut s);
    assert_eq!(s.phase(), Phase::Rest);
    assert_eq!(s.cards[1].position, 0, "and it settles into focus");
}

/// One card has nothing to switch between, so it just zooms out of the screen.
#[test]
fn opening_a_single_card_zooms_out() {
    let r = recents(&["Ping"]);
    let mut s = Switcher::open(&r, true);
    assert_eq!(s.phase(), Phase::Opening);
    assert_eq!(s.focused, 0);

    // It starts as the whole screen and ends in the focused slot.
    let first = s.placed().pop().expect("one card").state;
    assert!(first.w >= switcher::slot(0).unwrap().w);
    finish(&mut s);
    assert_eq!(s.placed()[0].state, switcher::slot(0).unwrap());
}

/// Down goes older, Up goes newer, and both stop at the ends with a tug rather
/// than wrapping.
#[test]
fn navigation_is_bounded_and_tugs_at_the_ends() {
    let r = recents(&["Ping", "Progress"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    assert_eq!(s.focused, 1, "the opener leaves the focus on the previous app");

    // Up moves back to the most recent.
    assert_eq!(s.key(Up), None);
    assert_eq!(s.phase(), Phase::Scrolling);
    finish(&mut s);
    assert_eq!(s.focused, 0);
    assert_eq!(s.cards[0].position, 0);
    assert_eq!(s.cards[1].position, -1);

    // Up again has nowhere to go: the focused card is tugged and the focus stays.
    assert_eq!(s.key(Up), None);
    assert_eq!(s.phase(), Phase::Bouncing);
    part_way();
    let bounced = s.placed().iter().find(|p| p.name == "Ping").unwrap().state.y;
    assert!(
        bounced != switcher::slot(0).unwrap().y,
        "the tug should move the card off its slot"
    );
    finish(&mut s);
    assert_eq!(s.focused, 0, "and it springs back with the focus unchanged");
    // placed() is furthest-first, so the focused card is looked up by name rather
    // than by being first.
    let settled = s.placed().iter().find(|p| p.name == "Ping").unwrap().state;
    assert_eq!(settled, switcher::slot(0).unwrap());

    // The other end behaves the same.
    s.key(Down);
    finish(&mut s);
    assert_eq!(s.focused, 1);
    s.key(Down);
    assert_eq!(s.phase(), Phase::Bouncing);
    finish(&mut s);
    assert_eq!(s.focused, 1);
}

/// A press mid-animation is ignored, so a double press cannot shift the stack
/// twice for one visible step.
#[test]
fn a_press_while_moving_is_dropped() {
    let r = recents(&["Ping", "Progress", "Speed Test"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);

    s.key(Down);
    assert_eq!(s.phase(), Phase::Scrolling);
    let focus = s.focused;
    assert_eq!(s.key(Down), None);
    assert_eq!(s.focused, focus, "the second press did nothing");
}

/// OK, Run and the switcher key all launch, and the launch waits for the zoom so
/// the app appears at the end of the animation rather than behind it.
#[test]
fn a_launch_waits_for_the_zoom() {
    for key in [Ok, Run, AppSwitch] {
        let r = recents(&["Ping", "Progress"]);
        let mut s = Switcher::open(&r, true);
        finish(&mut s);

        assert_eq!(s.key(key), None, "{key:?} should not act immediately");
        assert_eq!(s.phase(), Phase::Closing);
        assert_eq!(s.tick(), None, "nothing happens until the zoom lands");
        assert_eq!(finish(&mut s), Some(Action::Launch("Progress".into(), Kind::App)));
        assert_eq!(s.phase(), Phase::Rest);
    }
}

/// Back leaves without touching anything.
#[test]
fn back_closes() {
    let r = recents(&["Ping", "Progress"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    assert_eq!(s.key(Back), Some(Action::Close));
}

/// Escape kills the focused app, and the focus lands on the next one along.
#[test]
fn escape_kills_the_focused_app() {
    let r = recents(&["Ping", "Progress", "Speed Test"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    assert_eq!(s.focused, 1);
    assert!(s.can_kill());

    assert_eq!(s.key(Escape), Some(Action::Kill("Progress".into(), Kind::App)));
    assert_eq!(s.phase(), Phase::Killing);
    assert!(!s.can_kill(), "no Kill button while one is on its way out");

    // The killed card slides left, over the survivors.
    part_way();
    let placed = s.placed();
    let killed = placed.last().expect("drawn on top");
    assert_eq!(killed.name, "Progress");
    assert!(killed.state.x < switcher::slot(0).unwrap().x);

    finish(&mut s);
    assert_eq!(s.cards.len(), 2);
    assert_eq!(s.cards[s.focused].name, "Speed Test", "the next one along");
    assert_eq!(s.phase(), Phase::Rest);
}

/// Killing the last card closes the switcher: there is nothing left to show.
#[test]
fn killing_the_last_card_closes() {
    let r = recents(&["Ping"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    assert_eq!(s.key(Escape), Some(Action::Kill("Ping".into(), Kind::App)));
    assert_eq!(finish(&mut s), Some(Action::Close));
    assert!(s.is_empty());
}

/// Settings and Network are cards too. Going back to one is a navigation rather
/// than a process taking focus, and ending one stops nothing, so the action says
/// which sort it is and the caller does the right thing.
#[test]
fn a_screen_is_a_card_of_its_own_kind() {
    let mut r = Recents::default();
    r.open("Ping", Kind::App);
    r.open("Settings", Kind::Screen);
    assert_eq!(r.kind("Settings"), Some(Kind::Screen));
    assert_eq!(r.kind("Ping"), Some(Kind::App));
    assert_eq!(r.kind("Nothing"), None);

    let mut s = Switcher::open(&r, false);
    finish(&mut s);
    assert_eq!(s.focused, 0, "not looking at a card, so the most recent");

    // Launching says it is a screen, so the caller navigates rather than hunting
    // for a process that was never started.
    s.key(Ok);
    assert_eq!(
        finish(&mut s),
        Some(Action::Launch("Settings".into(), Kind::Screen))
    );

    // And killing one is a stack removal, not a signal.
    let mut s = Switcher::open(&r, false);
    finish(&mut s);
    assert_eq!(
        s.key(Escape),
        Some(Action::Kill("Settings".into(), Kind::Screen))
    );
}

/// Opening while looking at the top card focuses the one below it, which is what
/// makes Tab twice a switch. Opening from anywhere else focuses the most recent.
#[test]
fn where_the_focus_starts_depends_on_where_you_were() {
    let r = recents(&["Ping", "Progress"]);

    let mut from_card = Switcher::open(&r, true);
    assert_eq!(from_card.focused, 1);
    finish(&mut from_card);
    assert_eq!(from_card.focused, 1);

    let mut from_elsewhere = Switcher::open(&r, false);
    assert_eq!(from_elsewhere.focused, 0);
    assert_eq!(from_elsewhere.phase(), Phase::Opening, "it zooms out instead");
    finish(&mut from_elsewhere);
    assert_eq!(from_elsewhere.focused, 0);
}

/// Styles by slot: the focused card wears a title bar, the ones either side of it
/// show a strip of their app at full strength, and anything further is not drawn.
#[test]
fn slots_carry_their_own_style() {
    let r = recents(&["A", "B", "C", "D"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    // One step older, so C is focused with D below it, B peeking above, and A
    // past the peek where there is no slot at all.
    s.key(Down);
    finish(&mut s);

    let placed = s.placed();
    let by = |name: &str| placed.iter().find(|p| p.name == name).cloned();

    let focused = by("C").expect("focused card");
    assert_eq!(focused.pos_clamped, 0.0);
    assert_eq!(focused.image_alpha, 1.0, "its thumbnail is fully visible");
    assert!(!focused.deep);

    for name in ["D", "B"] {
        let card = by(name).expect("a background card");
        assert_eq!(card.pos_clamped, 1.0, "it is drawn in the background style");
        assert_eq!(card.image_alpha, 1.0, "a background card is a strip of its app");
        assert!(!card.deep, "it has a frame of its own, so it is no grey bar");
    }

    // The card two above the focus has no slot and is not drawn at all.
    assert!(by("A").is_none(), "nothing past the peek is drawn");
}

/// A card whose app has ended is dropped where it stands, and the stack closes up.
///
/// Not the kill slide: nothing was chosen, so there is nothing to animate. What
/// matters is that no card is left pointing at a process that is gone.
#[test]
fn a_card_can_be_dropped_when_its_app_ends() {
    let r = recents(&["Ping", "Progress", "Speed Test"]);
    let mut s = Switcher::open(&r, true);
    finish(&mut s);
    assert_eq!(s.cards.len(), 3);
    assert_eq!(s.focused, 1);

    // The one in front of the focus ends.
    assert!(s.drop_card("Ping"));
    assert_eq!(s.cards.len(), 2);
    assert_eq!(s.phase(), Phase::Rest, "no animation to play");
    let names: Vec<&str> = s.cards.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Progress", "Speed Test"]);
    // The focus stayed on a card that still exists, and the slots were re-parked.
    assert!(s.focused < s.cards.len());
    assert!(s.placed().iter().any(|p| p.pos_clamped == 0.0), "one is focused");

    // Something not in the stack is not an error, and the last one leaves it empty.
    assert!(!s.drop_card("Nothing"));
    assert!(s.drop_card("Progress"));
    assert!(s.drop_card("Speed Test"));
    assert!(s.is_empty());
}
