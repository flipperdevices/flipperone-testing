#!/bin/sh
# Take the panel: stop the prototype and its server, then run this build on it.
#
# Meant to be run ON the Flipper One, from the tree build_deploy.sh copies over:
#
#     ssh user@flipper 'cd flipctl-slint && ./run_me.sh'
#
# It builds nothing. Use build_deploy.sh to copy and compile; this only decides
# who owns the screen, which is the part worth having as one command:
#
#   cog-seat1                 the prototype's browser, holding DRM master
#   fake-flipctl-node-server  the prototype's own server on 8899
#   flipper-ui-demo           this, whatever it was last started with
#
# The remote view stays on, so the browser page keeps working; the comparison
# page does not, because the prototype it compares against is what we just
# stopped. Pass a peer as the first argument to keep it (PEER=host:port).
set -eu

PORT="${REMOTE_PORT:-9999}"
PEER="${PEER-}"
DEST="$(cd "$(dirname "$0")" && pwd)"
BIN="$DEST/target/release/flipper-ui-demo"
UNIT=flipper-ui-demo

# This takes DRM master and stops a compositor, so it refuses anywhere that is
# not the device. Same guard build_deploy.sh applies from the other end.
model=/sys/firmware/devicetree/base/model
if ! [ -e "$model" ] || ! tr -d '\0' < "$model" | grep -qi flipper; then
    echo "refusing: this is not a Flipper One" >&2
    exit 1
fi
if ! [ -x "$BIN" ]; then
    echo "no binary at $BIN; run build_deploy.sh first" >&2
    exit 1
fi

# The panel is single-owner: whoever holds card0 has to let go before we can.
for unit in cog-seat1 fake-flipctl-node-server "$UNIT"; do
    if [ "$(systemctl is-active "$unit.service" 2>/dev/null)" = active ]; then
        echo "stopping $unit"
        sudo systemctl stop "$unit.service" || true
    fi
done
sudo systemctl reset-failed "$UNIT.service" 2>/dev/null || true

ARGS="--panel --remote 0.0.0.0:$PORT --assets crates/flipper-ui/assets/remote"
[ -n "$PEER" ] && ARGS="$ARGS --peer $PEER"

echo "starting $UNIT $ARGS"
# A transient unit rather than a background process: the logs land in the journal
# and it survives the ssh session closing.
# shellcheck disable=SC2086
# The unit's own environment, not a login shell's. Building a Rust app needs the
# toolchain, which rustup puts in a home directory nothing else would look in, and
# the shim needs RUSTUP_HOME to pick a toolchain at all: the service runs as root,
# whose HOME has no rustup in it, and without this `cargo --version` fails with
# "could not choose a version of cargo to run".
sudo systemd-run --unit="$UNIT" --collect --working-directory="$DEST" \
    --setenv="PATH=$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin" \
    --setenv="RUSTUP_HOME=$HOME/.rustup" \
    --setenv="CARGO_HOME=$HOME/.cargo" \
    "$BIN" $ARGS >/dev/null

i=0
while [ "$i" -lt 30 ]; do
    state=$(systemctl is-active "$UNIT.service" 2>/dev/null || true)
    [ "$state" = active ] && break
    i=$((i + 1))
    sleep 1
done
if [ "${state:-}" != active ]; then
    echo "failed to start:" >&2
    sudo journalctl -u "$UNIT" -n 20 --no-pager -o cat >&2
    exit 1
fi

sudo journalctl -u "$UNIT" -n 6 --no-pager -o cat
echo
echo "  http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT/"
