//! Bootable profiles, for the boot menu.
//!
//! A profile is a btrfs subvolume the device can boot into. The list comes from
//! `list-profiles`, and which one is marked to boot next from the metadata
//! partition via `flipmeta`. Both are the tools the prototype's server shells out
//! to, and there is no kernel interface to read instead: the subvolume layout and
//! the boot marker are conventions of this image, not facts the kernel exposes.
//!
//! Nothing here writes. Renaming, cloning, deleting and factory-resetting a
//! profile are the destructive half of the boot menu and are deliberately absent
//! until they have somewhere safe to be tested.

use std::process::{Command, Stdio};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Profile {
    /// Subvolume name, e.g. `@Minimal` or `@Desktop__My-Games__`.
    pub name: String,
    /// The profile currently running.
    pub booted: bool,
    /// Subvolume id, which is also what the boot marker records.
    pub id: String,
    pub created: String,
    /// `now` for the booted one, `never` if it has not been, else a timestamp.
    pub last_used: String,
    pub parent: String,
    /// `origin_stock_name`, from which the base name and the icon are derived.
    pub origin: String,
    /// Marked to boot next, per the metadata partition.
    pub auto_boot: bool,
}

fn sudo(args: &[&str]) -> Option<String> {
    let out = Command::new("sudo")
        .args(args)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

/// The bootable profiles, in the order `list-profiles` reports them.
///
/// Columns are positional and separated by runs of two or more spaces:
///
/// ```text
/// NAME [<- booted] KIND ID CREATED LAST_USED RO PARENT ORIGIN
/// ```
///
/// The booted marker sits in its own column and shifts everything after it,
/// which is why the offset is computed rather than fixed. Anything that is not a
/// `profile` is skipped: `_old` backups are leftovers, not somewhere to boot.
pub fn profiles() -> Vec<Profile> {
    // The marker is a subvolume id. Absent or unparseable means nothing is marked.
    let marked = sudo(&["flipmeta", "get", "boot"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or_default();
    let Some(listing) = sudo(&["list-profiles"]) else {
        return Vec::new();
    };
    parse_listing(&listing, &marked)
}

/// The listing, parsed. Split out so it can be tested against real output.
pub fn parse_listing(listing: &str, marked: &str) -> Vec<Profile> {
    let mut out = Vec::new();
    let mut started = false;
    for line in listing.lines() {
        let line = line.trim();
        if !started {
            started = line.starts_with("NAME");
            continue;
        }
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split("  ").filter(|c| !c.trim().is_empty()).map(str::trim).collect();
        if cols.len() < 4 {
            continue;
        }
        let booted = cols.get(1).is_some_and(|c| *c == "<- booted");
        let base = if booted { 2 } else { 1 };
        if cols.get(base).is_none_or(|k| *k != "profile") {
            continue;
        }
        let id = cols.get(base + 1).unwrap_or(&"").to_string();
        // PARENT and ORIGIN carry the stock's id as "name (id)".
        let strip_id = |s: &str| s.split(" (").next().unwrap_or(s).trim().to_string();
        let dash_to_empty = |s: String| if s == "-" { String::new() } else { s };
        out.push(Profile {
            auto_boot: !marked.is_empty() && id == marked,
            name: cols[0].to_string(),
            booted,
            created: cols.get(base + 2).unwrap_or(&"").to_string(),
            last_used: cols.get(base + 3).unwrap_or(&"").to_string(),
            parent: dash_to_empty(strip_id(cols.get(base + 5).unwrap_or(&""))),
            origin: dash_to_empty(strip_id(cols.get(base + 6).unwrap_or(&""))),
            id,
        });
    }
    out
}

/// The base name inside an origin, e.g. `@Desktop_968_stock` gives `Desktop`.
pub fn origin_base(origin: &str) -> String {
    let trimmed = origin.trim_start_matches('@');
    let Some(rest) = trimmed.strip_suffix("_stock") else {
        return String::new();
    };
    // What remains is `<base>_<build>`; the build is all digits.
    match rest.rsplit_once('_') {
        Some((base, build)) if !build.is_empty() && build.chars().all(|c| c.is_ascii_digit()) => {
            base.to_string()
        }
        _ => String::new(),
    }
}

/// What the row shows.
///
/// One a user derived is named `@Base__label__` and shows its label in brackets,
/// so a clone is visibly a clone. Anything else shows its plain name.
///
/// A dash reads as a space either way. boot_menu.js only does that inside the
/// brackets, which leaves an image called `@No-Graphics` reading as a subvolume
/// name rather than as a name; every profile is spelled the same way here.
pub fn display_name(name: &str) -> String {
    let raw = name.trim_start_matches('@');
    match raw.split_once("__") {
        Some((_, rest)) => match rest.strip_suffix("__") {
            Some(label) => format!("[{}]", label.replace('-', " ")),
            None => raw.replace('-', " "),
        },
        None => raw.replace('-', " "),
    }
}

/// Which icon a profile takes, keyed off its origin's base name and falling back
/// to its own.
pub fn icon_key(name: &str, origin: &str) -> &'static str {
    let base = origin_base(origin);
    for candidate in [base.as_str(), name] {
        let n = candidate.to_lowercase();
        if n.contains("graphics") {
            return "graphics";
        }
        if n.contains("minimal") {
            return "minimal";
        }
        if n.contains("desktop") {
            return "desktop";
        }
        if n.contains("router") {
            return "router";
        }
        if n.contains("media") || n.contains("tv") {
            return "media";
        }
    }
    ""
}

/// The status text: how long ago the profile was last booted.
///
/// Singular units, matching the mockup. Two sentinels: nothing at all for a
/// profile never booted, and `Running` for the one running now, because "used 0
/// minutes ago" is a strange way to say that.
pub fn used_ago(last_used: &str, now: std::time::SystemTime) -> String {
    match last_used {
        "" | "never" => return String::new(),
        "now" => return "Running".into(),
        _ => {}
    }
    let Some(then) = parse_stamp(last_used) else {
        // Not a timestamp: show it verbatim rather than inventing one.
        return last_used.to_string();
    };
    let now_secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let secs = (now_secs - then).max(0);
    let plural = |n: i64, unit: &str| {
        format!("Used {n} {unit}{} ago", if n == 1 { "" } else { "s" })
    };
    if secs < 60 {
        return "Used just now".into();
    }
    let mins = secs / 60;
    if mins < 60 {
        return plural(mins, "min");
    }
    let hours = mins / 60;
    if hours < 24 {
        return plural(hours, "hour");
    }
    let days = hours / 24;
    if days < 30 {
        return plural(days, "day");
    }
    let months = days / 30;
    if months < 12 {
        return plural(months, "month");
    }
    plural(days / 365, "year")
}

/// Exposed for tests, which need a fixed instant to measure against.
pub fn parse_stamp_for_test(s: &str) -> Option<i64> {
    parse_stamp(s)
}

/// `YYYY-MM-DD HH:MM:SS` as a Unix timestamp, treated as UTC.
///
/// Written out rather than pulled from a crate: the only timestamps here come
/// from one tool in one format, and the comparison is against wall-clock seconds.
fn parse_stamp(s: &str) -> Option<i64> {
    let (date, time) = s.trim().split_once(' ')?;
    let mut d = date.split('-');
    let (y, m, day) = (
        d.next()?.parse::<i64>().ok()?,
        d.next()?.parse::<i64>().ok()?,
        d.next()?.parse::<i64>().ok()?,
    );
    let mut t = time.split(':');
    let (hh, mm, ss) = (
        t.next()?.parse::<i64>().ok()?,
        t.next()?.parse::<i64>().ok()?,
        t.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
    );
    Some(days_from_civil(y, m, day) * 86400 + hh * 3600 + mm * 60 + ss)
}

/// Howard Hinnant's civil-to-days conversion, which is exact and short.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// ── Sizes and details, for the Info popup ──────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Space {
    /// Freed by deleting this subvolume alone, uncompressed.
    pub unique: String,
    /// Real on-disk size, compressed. Counts shared extents, so not additive.
    pub referenced: String,
    /// Apparent size, uncompressed.
    pub total: String,
}

/// Disk space for one subvolume.
///
/// `btrfs-show-space -q <@subvol>` prints just that subvolume, as
/// `TOTAL=.. UNIQUE=..`, and takes a few seconds. Without the name it measures
/// every subvolume on the filesystem, which is 19 of them here and over a minute:
/// that is the whole-filesystem report, not this.
///
/// `-q` skips the compsize walk that produces REFERENCED, which is the expensive
/// half. The popup only labels one number "Size", so the extra walk buys nothing.
///
/// Sizes are the tool's own strings ("3.5GB") and are never reformatted, so every
/// view of the same number agrees.
pub fn space(name: &str) -> Option<Space> {
    if !valid_name(name) {
        return None;
    }
    parse_space(&sudo(&["btrfs-show-space", "-q", name])?)
}

/// The `KEY=value` pairs `btrfs-show-space <@subvol>` prints.
pub fn parse_space(out: &str) -> Option<Space> {
    let field = |key: &str| {
        out.split_whitespace()
            .find_map(|tok| tok.strip_prefix(key))
            .map(str::to_string)
    };
    let total = field("TOTAL=")?;
    Some(Space {
        unique: field("UNIQUE=").unwrap_or_default(),
        // Absent under -q, which is the mode this uses.
        referenced: field("REFERENCED=").unwrap_or_default(),
        total,
    })
}

/// Device tree overlays a profile applies at boot.
///
/// Read from the profile's BLS entry, not from a directory. The overlays a profile
/// actually gets are whatever its boot entry's `devicetree-overlay` line names, and
/// that is the only place the answer exists: the files live inside the profile's own
/// subvolume, which is not mounted unless it is the one running.
///
/// The entry is found by its `options` line carrying `rootflags=subvol=<name>`.
/// Entries are sorted and the last match wins, which is the newest kernel, matching
/// the order the bootloader itself would pick.
///
/// System and user overlays are split by path: a drop-in under /etc/kernel/dtbo is
/// something someone added, anything else ships with the image.
pub fn dtbo(subvol: &str) -> (Vec<String>, Vec<String>) {
    dtbo_in(std::path::Path::new("/boot/loader/entries"), subvol)
}

/// `dtbo`, against a given entries directory. Split out so it can be tested.
pub fn dtbo_in(dir: &std::path::Path, subvol: &str) -> (Vec<String>, Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (Vec::new(), Vec::new());
    };
    let mut confs: Vec<std::path::PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "conf"))
        .collect();
    confs.sort();

    let want = format!("rootflags=subvol={subvol}");
    let mut chosen = None;
    for path in confs {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let matches = text.lines().filter(|l| l.starts_with("options")).any(|l| {
            // The option must end at a word boundary, or @Minimal would match
            // @Minimal__clone__.
            l.split_whitespace().any(|opt| opt == want)
        });
        if matches {
            chosen = Some(text);
        }
    }
    let Some(text) = chosen else {
        return (Vec::new(), Vec::new());
    };

    let mut system = Vec::new();
    let mut user = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("devicetree-overlay") else {
            continue;
        };
        for path in rest.split_whitespace() {
            let base = path.rsplit('/').next().unwrap_or(path).to_string();
            if path.contains("/etc/kernel/dtbo/") {
                user.push(base);
            } else {
                system.push(base);
            }
        }
    }
    (system, user)
}

// ── Actions ────────────────────────────────────────────────────────────────

/// A subvolume name safe to hand to the tools.
///
/// The prototype's server checks the same shape because it builds a shell command
/// out of it. Here the arguments go straight to execve with no shell, so this is
/// not about quoting: it is about not asking a tool to operate on something that
/// cannot be a profile.
fn valid_name(name: &str) -> bool {
    name.len() > 1
        && name.starts_with('@')
        && name[1..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn run(args: &[&str]) -> Result<(), String> {
    let out = Command::new("sudo")
        .args(args)
        .output()
        .map_err(|e| format!("cannot run {}: {e}", args[0]))?;
    if out.status.success() {
        return Ok(());
    }
    // The tools put the useful line last, on either stream.
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    Err(text
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("failed")
        .trim()
        .to_string())
}

/// Point the auto-boot marker at a profile.
pub fn set_auto_start(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("no subvolume id".into());
    }
    run(&["flipmeta", "set", "boot", id])
}

/// Copy a profile under a new name.
pub fn clone(source: &str, dest: &str) -> Result<(), String> {
    if !valid_name(source) || !valid_name(dest) {
        return Err("invalid name".into());
    }
    run(&["create-profile", "-y", source, dest])
}

/// Delete a profile, clearing the auto-boot marker if it pointed at it.
///
/// Order matters: the id has to be read before the subvolume goes, or there is
/// nothing left to compare the marker against and autoboot would be left pointing
/// at something deleted.
pub fn delete(name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("invalid name".into());
    }
    let was_marked = profiles()
        .into_iter()
        .find(|p| p.name == name)
        .is_some_and(|p| p.auto_boot);
    run(&["delete-profile", "-y", name])?;
    if was_marked {
        run(&["flipmeta", "del", "boot"])?;
    }
    Ok(())
}

/// Replace a profile with a fresh copy of the stock it came from.
///
/// `create-profile --no-keep` moves the old copy aside and gives the new one a
/// fresh subvolume id, so a marker that pointed at the old id has to be moved or
/// autoboot would land on the stale `_old` copy.
///
/// Returns true when the profile reset was the running one, which means the
/// caller has to reboot: the root now mounted is the copy that was moved aside.
pub fn factory_reset(name: &str, origin: &str) -> Result<bool, String> {
    if !valid_name(name) || !valid_name(origin) {
        return Err("invalid name".into());
    }
    let before = profiles();
    let was_marked = before
        .iter()
        .find(|p| p.name == name)
        .is_some_and(|p| p.auto_boot);
    let booted = before
        .iter()
        .find(|p| p.name == name)
        .is_some_and(|p| p.booted);

    run(&["create-profile", "-y", "--no-keep", origin, name])?;

    if was_marked {
        if let Some(fresh) = profiles().into_iter().find(|p| p.name == name) {
            if !fresh.id.is_empty() {
                set_auto_start(&fresh.id)?;
            }
        }
    }
    Ok(booted)
}

/// Rename a profile's label.
pub fn rename(name: &str, dest: &str) -> Result<(), String> {
    if !valid_name(name) || !valid_name(dest) {
        return Err("invalid name".into());
    }
    run(&["rename-profile", name, dest])
}

/// The destination name a clone of `p` should take.
///
/// `@Base__label__`, with the label derived from the source and a number appended
/// if that is taken, so cloning twice does not fail on a name collision.
pub fn clone_dest(p: &Profile, existing: &[Profile]) -> String {
    let base = {
        let b = origin_base(&p.origin);
        if b.is_empty() {
            p.name.trim_start_matches('@').to_string()
        } else {
            b
        }
    };
    let raw = p.name.trim_start_matches('@');
    let src = match raw.split_once("__") {
        Some((_, rest)) => rest.trim_end_matches('_').to_string(),
        None => raw.to_string(),
    };
    let safe: String = src
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let taken = |n: &str| existing.iter().any(|e| e.name == n);
    let first = format!("@{base}__{safe}-clone__");
    if !taken(&first) {
        return first;
    }
    (2..)
        .map(|n| format!("@{base}__{safe}-clone-{n}__"))
        .find(|c| !taken(c))
        .unwrap_or(first)
}

/// Whether a profile is one a user made, which is the `@Base__label__` shape the
/// list shows in brackets.
///
/// Everything else is an image: a factory profile, whose name is what ties it to
/// its stock, or a subvolume made outside this menu. Neither may be renamed or
/// deleted.
pub fn is_user_profile(name: &str) -> bool {
    label_of(name).is_some()
}

/// The label inside a `@Base__label__` name, if it has one.
fn label_of(name: &str) -> Option<&str> {
    let raw = name.trim_start_matches('@');
    let (_, rest) = raw.split_once("__")?;
    let label = rest.strip_suffix("__")?;
    (!label.is_empty()).then_some(label)
}

/// The label to seed the Rename field with: dashes read as spaces, and a name
/// with no label offered whole.
pub fn profile_label(name: &str) -> String {
    match label_of(name) {
        Some(label) => label.replace('-', " "),
        None => name.trim_start_matches('@').to_string(),
    }
}

/// Free text to a subvolume label: spaces become dashes and anything else that is
/// not a letter, a digit or a dash is dropped.
pub fn encode_label(text: &str) -> String {
    let collapsed: String = text
        .trim()
        .chars()
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    // A run of spaces became a run of dashes, and leading or trailing dashes are
    // not part of a name.
    let mut out = String::new();
    for c in collapsed.chars() {
        if c == '-' && out.ends_with('-') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches('-').to_string()
}

/// The name a rename to `text` would produce, or empty if the text carries no
/// usable label.
pub fn rename_dest(p: &Profile, text: &str) -> String {
    let label = encode_label(text);
    if label.is_empty() {
        return String::new();
    }
    let base = {
        let b = origin_base(&p.origin);
        if b.is_empty() {
            p.name.trim_start_matches('@').split("__").next().unwrap_or("").to_string()
        } else {
            b
        }
    };
    format!("@{base}__{label}__")
}

/// The actions offered for a profile.
///
/// Rename and Delete are only offered on a profile a user made. The booted one
/// cannot be deleted either, because `delete-profile` refuses it and there is no
/// point offering what will fail.
pub fn edit_actions(p: &Profile) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = if is_user_profile(&p.name) {
        vec!["Rename", "Clone", "Factory Reset", "Delete", "Auto Start"]
    } else {
        vec!["Clone", "Factory Reset", "Auto Start"]
    };
    if p.booted {
        out.retain(|a| *a != "Delete");
    }
    out
}

/// The Info popup's "Last used" line.
///
/// Longer than the row's version on purpose: the row has to fit beside a name, so
/// it says "Used 3 hours ago", while the popup has the width to give the relative
/// time and the timestamp it came from.
pub fn info_last_used(last_used: &str, now: std::time::SystemTime) -> String {
    match last_used {
        "now" => return "Running".into(),
        "" | "never" => return "never".into(),
        _ => {}
    }
    let rel = used_ago(last_used, now);
    match rel.strip_prefix("Used ") {
        Some(r) => format!("{r} ({last_used})"),
        None => last_used.to_string(),
    }
}

/// A size string split into its number and unit, for the popup's fixed slots.
///
/// The tools already format these ("3.5GB"), and reformatting would disagree with
/// what every other view of the same number says.
pub fn size_parts(s: &str) -> (String, String) {
    if s.is_empty() {
        return ("?".into(), String::new());
    }
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    if num.is_empty() {
        (s.to_string(), String::new())
    } else {
        (num.to_string(), unit.trim().to_string())
    }
}
