//! Boot profile parsing.
//!
//! The listing is positional and one column only sometimes exists, which is
//! exactly the shape that goes wrong silently, so it is pinned here against real
//! output from the device.

use flipper_ui::boot;

/// `list-profiles` output as the device prints it, booted marker and all.
const LISTING: &str = "\
Currently booted profile: @Minimal (id 263)

NAME                      KIND     ID   CREATED              LAST USED  RO  PARENT                         ORIGIN
@Desktop                  profile  265  2026-08-20 10:36:19  never      rw  @Desktop_968_stock (264)       @Desktop_968_stock (264)
@Minimal       <- booted  profile  263  2026-08-20 10:34:01  now        rw  @Minimal_968_stock (262)       @Minimal_968_stock (262)
@Desktop__My-Games__      profile  280  2026-08-19 09:00:00  2026-08-19 12:00:00  rw  @Desktop (265)  @Desktop_968_stock (264)
@Minimal_old_1            old      299  2026-08-01 00:00:00  never      ro  -                              -
";

/// The booted marker occupies its own column, shifting every field after it.
///
/// Parsing at fixed offsets reads the booted row's KIND as its ID and drops it,
/// so the profile you are running would be missing from the list.
#[test]
fn the_booted_marker_does_not_shift_the_other_columns() {
    let rows = boot::parse_listing(LISTING, "280");
    let names: Vec<&str> = rows.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(
        names,
        ["@Desktop", "@Minimal", "@Desktop__My-Games__"],
        "the _old row is a leftover, not somewhere to boot"
    );

    let minimal = rows.iter().find(|p| p.name == "@Minimal").unwrap();
    assert!(minimal.booted);
    assert_eq!(minimal.id, "263");
    assert_eq!(minimal.last_used, "now");
    assert_eq!(minimal.origin, "@Minimal_968_stock", "the id is stripped");

    let desktop = rows.iter().find(|p| p.name == "@Desktop").unwrap();
    assert!(!desktop.booted);
    assert_eq!(desktop.id, "265");
    assert_eq!(desktop.last_used, "never");

    // The marker is a subvolume id, and only the profile holding it is marked.
    let clone = rows.iter().find(|p| p.name == "@Desktop__My-Games__").unwrap();
    assert!(clone.auto_boot);
    assert!(!minimal.auto_boot);
}

/// A user profile shows its label in brackets; a factory one shows its name.
#[test]
fn a_derived_profile_is_named_by_its_label() {
    assert_eq!(boot::display_name("@Minimal"), "Minimal");
    assert_eq!(boot::display_name("@Desktop__My-Games__"), "[My Games]");
    // A dash is a space in every name, not only inside a label.
    assert_eq!(boot::display_name("@No-Graphics"), "No Graphics");
}

/// The icon follows the origin's base name, not the profile's own.
///
/// A clone called "[My Games]" carries no hint of what it came from, so keying
/// off its own name would give every clone the fallback icon.
#[test]
fn the_icon_follows_the_origin() {
    assert_eq!(boot::icon_key("@Desktop__My-Games__", "@Desktop_968_stock"), "desktop");
    assert_eq!(boot::icon_key("@Minimal", "@Minimal_968_stock"), "minimal");
    assert_eq!(boot::icon_key("@TV-Media-Box", "@TV-Media-Box_968_stock"), "media");
    assert_eq!(boot::icon_key("@Router", "@Router_968_stock"), "router");
    assert_eq!(boot::icon_key("@No-Graphics", "@No-Graphics_968_stock"), "graphics");
    // No origin at all: fall back to the name.
    assert_eq!(boot::icon_key("@Router", ""), "router");
    assert_eq!(boot::icon_key("@Whatever", ""), "");
    assert_eq!(boot::origin_base("@Desktop_968_stock"), "Desktop");
    assert_eq!(boot::origin_base("@Desktop"), "", "not a stock name");
}

/// The two sentinels, then relative time in singular units.
#[test]
fn used_ago_reads_as_a_person_would_say_it() {
    let at = |s: &str| {
        std::time::UNIX_EPOCH
            + std::time::Duration::from_secs(
                boot::parse_stamp_for_test(s).expect("parseable") as u64,
            )
    };
    let now = at("2026-08-20 12:00:00");

    assert_eq!(boot::used_ago("never", now), "");
    assert_eq!(boot::used_ago("", now), "");
    assert_eq!(boot::used_ago("now", now), "Running");
    assert_eq!(boot::used_ago("2026-08-20 11:59:30", now), "Used just now");
    assert_eq!(boot::used_ago("2026-08-20 11:59:00", now), "Used 1 min ago");
    assert_eq!(boot::used_ago("2026-08-20 11:00:00", now), "Used 1 hour ago");
    assert_eq!(boot::used_ago("2026-08-20 09:00:00", now), "Used 3 hours ago");
    assert_eq!(boot::used_ago("2026-08-18 12:00:00", now), "Used 2 days ago");
    assert_eq!(boot::used_ago("2026-06-01 12:00:00", now), "Used 2 months ago");
    // Not a timestamp: shown verbatim rather than turned into a wrong duration.
    assert_eq!(boot::used_ago("yesterday", now), "yesterday");
}

/// A factory profile cannot be renamed or deleted, and the booted one cannot be
/// deleted at all.
///
/// Offering an action the tool refuses is worse than not offering it: the user
/// presses it, waits, and gets an error that was predictable.
#[test]
fn the_actions_offered_depend_on_the_profile() {
    let factory = boot::Profile {
        name: "@Minimal".into(),
        origin: "@Minimal_968_stock".into(),
        ..Default::default()
    };
    assert_eq!(
        boot::edit_actions(&factory),
        ["Clone", "Factory Reset", "Auto Start"],
        "a factory profile's name ties it to its stock"
    );

    let user = boot::Profile {
        name: "@Desktop__My-Games__".into(),
        origin: "@Desktop_968_stock".into(),
        ..Default::default()
    };
    assert_eq!(
        boot::edit_actions(&user),
        ["Rename", "Clone", "Factory Reset", "Delete", "Auto Start"]
    );

    let booted = boot::Profile { booted: true, ..user.clone() };
    assert!(
        !boot::edit_actions(&booted).contains(&"Delete"),
        "delete-profile refuses the running profile"
    );
}

/// A clone gets a fresh name, and cloning twice does not collide.
#[test]
fn a_clone_is_named_from_its_source() {
    let src = boot::Profile {
        name: "@Minimal".into(),
        origin: "@Minimal_968_stock".into(),
        ..Default::default()
    };
    let existing = vec![src.clone()];
    let first = boot::clone_dest(&src, &existing);
    assert_eq!(first, "@Minimal__Minimal-clone__");

    // With that one taken, the next gets a number rather than failing.
    let mut existing = existing;
    existing.push(boot::Profile { name: first.clone(), ..Default::default() });
    assert_eq!(boot::clone_dest(&src, &existing), "@Minimal__Minimal-clone-2__");

    // A clone of a clone reads from its label, not the whole subvolume name.
    let clone = boot::Profile {
        name: "@Desktop__My-Games__".into(),
        origin: "@Desktop_968_stock".into(),
        ..Default::default()
    };
    assert_eq!(boot::clone_dest(&clone, &[]), "@Desktop__My-Games-clone__");
}

/// Names that cannot be a profile are refused before a tool is asked to act.
#[test]
fn actions_refuse_a_name_that_cannot_be_a_profile() {
    for bad in ["", "@", "Minimal", "@has space", "@semi;colon", "@../escape"] {
        assert!(
            boot::clone(bad, "@Ok__x__").is_err(),
            "{bad:?} should be refused as a source"
        );
        assert!(
            boot::clone("@Minimal", bad).is_err(),
            "{bad:?} should be refused as a destination"
        );
    }
    assert!(boot::set_auto_start("").is_err());
    assert!(boot::set_auto_start("not-a-number").is_err());
}

/// Overlays come from the profile's own BLS entry, chosen by its subvol option.
///
/// Reading a directory instead cannot work: a profile's overlay files live inside
/// its subvolume, which is not mounted unless it is the one running, so every
/// profile but the booted one would report none.
#[test]
fn overlays_are_read_from_the_boot_entry() {
    let dir = std::env::temp_dir().join("flipper-ui-dtbo/loader/entries");
    let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    std::fs::create_dir_all(&dir).unwrap();

    // Two kernels for one profile, plus another profile whose name is a prefix.
    std::fs::write(
        dir.join("500-flipperos-No-Graphics-6.1.172.conf"),
        "options root=UUID=x rootflags=subvol=@No-Graphics\n\
         devicetree-overlay /@No-Graphics/usr/lib/old.dtbo\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("500-flipperos-No-Graphics-7.2.0.conf"),
        "options root=UUID=x rootflags=subvol=@No-Graphics\n\
         devicetree-overlay /@No-Graphics/usr/lib/rk3576-no-graphics.dtbo \
         /@No-Graphics/etc/kernel/dtbo/mine.dtbo\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("600-flipperos-Minimal-7.2.0.conf"),
        "options root=UUID=x rootflags=subvol=@Minimal\n",
    )
    .unwrap();

    let (system, user) = boot::dtbo_in(&dir, "@No-Graphics");
    assert_eq!(
        system,
        ["rk3576-no-graphics.dtbo"],
        "the newest kernel's entry wins, so the old overlay is not reported"
    );
    assert_eq!(user, ["mine.dtbo"], "a drop-in under /etc/kernel/dtbo is the user's");

    // A profile with an entry but no overlay line reports nothing, not the other
    // profile's overlays.
    assert_eq!(boot::dtbo_in(&dir, "@Minimal"), (Vec::new(), Vec::new()));

    // A name that is a prefix of another must not match it.
    assert_eq!(boot::dtbo_in(&dir, "@No"), (Vec::new(), Vec::new()));

    let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
}

/// The per-subvolume size output is KEY=value pairs, and -q omits REFERENCED.
#[test]
fn size_output_is_parsed_from_key_value_pairs() {
    let quick = boot::parse_space("TOTAL=3.6GB UNIQUE=1.1GB\n").unwrap();
    assert_eq!(quick.total, "3.6GB");
    assert_eq!(quick.unique, "1.1GB");
    assert_eq!(quick.referenced, "", "-q skips the compsize walk");

    let full = boot::parse_space("TOTAL=2.5GB UNIQUE=0.0B REFERENCED=1.4GB COMPRESSION=1.8\n")
        .unwrap();
    assert_eq!(full.referenced, "1.4GB");

    // The whole-filesystem report has no such pairs, so it must not be mistaken
    // for an answer.
    assert!(boot::parse_space("== subvolumes ==\n@Minimal 1.1GB 2.0GB 3.6GB\n").is_none());
    assert!(boot::parse_space("Error: No such subvolume: @Nope\n").is_none());
}

/// Rename and Delete are only offered on a profile a user made, which is the one
/// the list shows in brackets.
///
/// The real listing is the fixture, because this is exactly the case that was
/// wrong on the device: an image whose name does not match its origin base is
/// still an image, not something to rename or delete.
#[test]
fn only_a_user_profile_may_be_renamed_or_deleted() {
    let listing = "\
NAME                                        KIND     ID   CREATED              LAST USED  RO  PARENT                                ORIGIN
@Desktop_Computer                           profile  276  2026-08-20 14:34:48  never      rw  @Desktop_968_stock (264)              @Desktop_968_stock (264)
@Minimal                         <- booted  profile  263  2026-08-20 10:34:01  now        rw  @Minimal_968_stock (262)              @Minimal_968_stock (262)
@TV-Media-Box__TV-Media-Box-clone__         profile  273  2026-08-20 13:40:01  never      rw  @TV-Media-Box (267)                   @TV-Media-Box_968_stock (266)
";
    let profiles = boot::parse_listing(listing, "");
    let by = |name: &str| {
        profiles.iter().find(|p| p.name == name).expect("profile in the listing").clone()
    };

    // A factory image: its name is its origin base.
    assert_eq!(
        boot::edit_actions(&by("@Minimal")),
        ["Clone", "Factory Reset", "Auto Start"]
    );
    // An image made outside this menu. No brackets in the list, so no Rename and
    // no Delete either, even though its name differs from the base.
    assert_eq!(boot::display_name("@Desktop_Computer"), "Desktop_Computer");
    assert_eq!(boot::display_name("@TV-Media-Box"), "TV Media Box");
    assert_eq!(
        boot::edit_actions(&by("@Desktop_Computer")),
        ["Clone", "Factory Reset", "Auto Start"]
    );
    // A user profile, shown in brackets, gets everything.
    let user = by("@TV-Media-Box__TV-Media-Box-clone__");
    assert_eq!(boot::display_name(&user.name), "[TV Media Box clone]");
    assert_eq!(
        boot::edit_actions(&user),
        ["Rename", "Clone", "Factory Reset", "Delete", "Auto Start"]
    );
}

/// The Rename field is seeded with the label, and what it produces is a
/// `@Base__label__` name built from the origin.
#[test]
fn a_rename_builds_a_name_from_the_origin_base() {
    let listing = "\
NAME                                   KIND     ID   CREATED              LAST USED  RO  PARENT                     ORIGIN
@TV-Media-Box__movie-night__           profile  273  2026-08-20 13:40:01  never      rw  @TV-Media-Box (267)        @TV-Media-Box_968_stock (266)
";
    let p = boot::parse_listing(listing, "").remove(0);
    assert_eq!(boot::profile_label(&p.name), "movie night");
    assert_eq!(
        boot::rename_dest(&p, "Movie Night 2"),
        "@TV-Media-Box__Movie-Night-2__"
    );
    // Punctuation is not part of a subvolume name, and the edges are trimmed.
    assert_eq!(boot::encode_label("  hello, world!  "), "hello-world");
    assert_eq!(boot::encode_label("***"), "");
    // Nothing usable in the text means no destination, which is what refuses the
    // commit.
    assert_eq!(boot::rename_dest(&p, "  "), "");
}
