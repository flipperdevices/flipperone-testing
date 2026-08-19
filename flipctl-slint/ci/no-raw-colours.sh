#!/bin/sh
# tokens.toml is the only place a colour or a layout constant may be written
# down. build.rs turns it into the Rust and Slint themes; everything else reads
# those. Clippy cannot see .slint files, so this is a script rather than a lint.
#
# Run from the repo root. Exits non-zero on the first offender.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

status=0

# Hex colour literals. tokens.toml, the generated output and the doc comments
# that quote a token's value are the only legitimate holders.
hits=$(grep -rInE '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b' \
        --include='*.rs' --include='*.slint' \
        crates bin 2>/dev/null \
    | grep -v '^crates/flipper-ui/build.rs:' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|///|//!)' \
    || true)
if [ -n "$hits" ]; then
    echo "raw colour literals outside tokens.toml:"
    echo "$hits"
    status=1
fi

# Panel dimensions. Anything hardcoding 256 or 144 has bypassed theme::PANEL_W.
hits=$(grep -rInE '\b(256|144)\b' \
        --include='*.rs' --include='*.slint' \
        crates bin 2>/dev/null \
    | grep -v '^crates/flipper-ui/build.rs:' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|///|//!)' \
    | grep -vE 'PANEL_[WH]' \
    || true)
if [ -n "$hits" ]; then
    echo "hardcoded panel dimensions; use theme::PANEL_W / PANEL_H:"
    echo "$hits"
    status=1
fi

[ "$status" -eq 0 ] && echo "no raw colours or panel dimensions outside tokens.toml"
exit "$status"
