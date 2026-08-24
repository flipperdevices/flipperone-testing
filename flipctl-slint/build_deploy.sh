#!/bin/bash
# Copy this workspace to a Flipper One, build it there, and restart the demo.
#
# The host toolchain generally has no aarch64 std, so the build happens on the
# device: 8 cores and 8 GB make a cold build about 8 minutes and an incremental
# one about 25 seconds.
#
# Usage:
#   ./build_deploy.sh                 headless, with the prototype comparison
#   ./build_deploy.sh --panel         drive the real panel and its buttons
#   ./build_deploy.sh --no-run        build only, leave whatever is running alone
#   ./build_deploy.sh --status        report what is running, change nothing
#
# Environment:
#   FLIPPER_HOST  default 192.168.1.110
#   FLIPPER_USER  default user
#   FLIPPER_PASS  default user; unset it to use key auth instead
#   REMOTE_PORT   default 9999
#   PEER          default 127.0.0.1:8899, the fake-flipctl2 server to compare
#                 against; empty disables the comparison page
set -euo pipefail

HOST="${FLIPPER_HOST:-192.168.1.110}"
USER_="${FLIPPER_USER:-user}"
PASS="${FLIPPER_PASS-user}"
PORT="${REMOTE_PORT:-9999}"
PEER="${PEER-127.0.0.1:8899}"
DEST="flipctl-slint"
UNIT="flipper-ui-demo"

MODE=headless
RUN=yes
for arg in "$@"; do
    case "$arg" in
        --panel)   MODE=panel ;;
        --headless) MODE=headless ;;
        --no-run)  RUN=no ;;
        --status)  MODE=status ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

# Password auth only if sshpass is present and FLIPPER_PASS is set; otherwise
# plain ssh, which picks up keys.
# One connection, reused. A deploy makes a dozen ssh calls and each was paying a
# full TCP and auth handshake; multiplexing them onto a single master cuts that to
# one. The socket lives in a temp dir and is closed on exit.
MUX_DIR=$(mktemp -d)
trap 'ssh -O exit -o ControlPath="$MUX_DIR/s" "$USER_@$HOST" 2>/dev/null; rm -rf "$MUX_DIR"' EXIT
MUX=(-o ControlMaster=auto -o ControlPath="$MUX_DIR/s" -o ControlPersist=60)

if [ -n "${PASS:-}" ] && command -v sshpass >/dev/null; then
    SSH=(sshpass -p "$PASS" ssh -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR "${MUX[@]}")
else
    SSH=(ssh -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR "${MUX[@]}")
fi
run() { "${SSH[@]}" "$USER_@$HOST" "$@"; }

# Refuse anywhere that is not a Flipper One. The demo takes DRM master on card0
# and stops cog, so a wrong host would fight a desktop compositor.
guard='test -e /sys/firmware/devicetree/base/model &&
       tr -d "\0" < /sys/firmware/devicetree/base/model | grep -qi flipper'
if ! run "$guard"; then
    echo "refusing: $HOST does not report itself as a Flipper One" >&2
    exit 1
fi

if [ "$MODE" = status ]; then
    echo "== $HOST =="
    run "systemctl is-active $UNIT.service || true"
    run "sudo ss -ltnp 2>/dev/null | grep -E ':(8899|$PORT) ' || echo 'nothing listening'"
    run "systemctl is-active cog-seat1.service || true" | sed 's/^/cog-seat1: /'
    run "sudo journalctl -u $UNIT -n 12 --no-pager -o cat 2>/dev/null || true"
    exit 0
fi

echo "== copying source to $USER_@$HOST:~/$DEST =="
# tar over ssh rather than rsync: the device image has no rsync. target/ is 16 GB
# of build output and never travels.
tar czf - \
    --exclude target --exclude .git --exclude '*.actual.png' \
    -C "$(cd "$(dirname "$0")" && pwd)" . \
  | run "mkdir -p ~/$DEST && tar xzf - -C ~/$DEST"

echo "== building on the device =="
# LTO off and 16 codegen units are for iteration speed. Drop both when measuring
# binary size.
run "cd ~/$DEST && export PATH=\$HOME/.cargo/bin:\$PATH \
        CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 && \
     cargo build --release -p flipper-ui-demo --features device,slint,remote,wayland,gpu 2>&1 | tail -3"

if [ "$RUN" = no ]; then
    echo "== built, nothing restarted =="
    exit 0
fi

ARGS="--remote 0.0.0.0:$PORT --assets crates/flipper-ui/assets/remote"
[ -n "$PEER" ] && ARGS="$ARGS --peer $PEER"
if [ "$MODE" = panel ]; then
    # The panel is single-owner: cog holds card0 and has to let go first.
    echo "== stopping cog-seat1 to release the panel =="
    run "sudo systemctl stop cog-seat1.service" || true
    ARGS="--panel $ARGS"
else
    # Headless leaves the panel to whoever has it, so the prototype can keep
    # rendering on glass while this serves the browser.
    ARGS="--headless $ARGS"
fi

echo "== restarting $UNIT ($MODE) =="
# A transient unit rather than a backgrounded ssh command: backgrounding does not
# survive the session closing, and this way the logs land in the journal.
run "sudo systemctl stop $UNIT.service 2>/dev/null; \
     sudo systemctl reset-failed $UNIT.service 2>/dev/null; \
     sudo systemd-run --unit=$UNIT --collect --working-directory=/home/$USER_/$DEST \
        --setenv=PATH=/home/$USER_/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
        --setenv=RUSTUP_HOME=/home/$USER_/.rustup \
        --setenv=CARGO_HOME=/home/$USER_/.cargo \
        /home/$USER_/$DEST/target/release/flipper-ui-demo $ARGS" >/dev/null

# Wait for it rather than sleeping a guessed amount.
for _ in $(seq 30); do
    state=$(run "systemctl is-active $UNIT.service" || true)
    [ "$state" = active ] && break
    sleep 1
done
if [ "$state" != active ]; then
    echo "== failed to start ==" >&2
    run "sudo journalctl -u $UNIT -n 20 --no-pager -o cat" >&2
    exit 1
fi

echo "== running =="
run "sudo journalctl -u $UNIT -n 6 --no-pager -o cat"
echo
echo "  http://$HOST:$PORT/          the panel in a device photo"
echo "  http://$HOST:$PORT/diff      side-by-side comparison and controls"
