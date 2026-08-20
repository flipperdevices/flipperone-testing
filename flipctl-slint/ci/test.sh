#!/bin/sh
# Everything CI runs. Use this rather than a bare `cargo test`.
#
# The rendering tests are gated on the `slint` feature, which is not a default, so
# a bare `cargo test` compiles none of them and reports success while they are
# broken. That happened: a change to the ListItem struct left three of them
# failing to compile and the suite still went green.
set -e

echo "== token and font tests (no renderer) =="
cargo test --quiet

echo "== rendering tests (needs the compiled components) =="
cargo test --quiet -p flipper-ui --features slint

echo "== no raw colours or panel dimensions =="
./ci/no-raw-colours.sh

echo "== all green =="
