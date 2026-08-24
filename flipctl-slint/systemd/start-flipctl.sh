#!/bin/sh
# Start flipctl inside the compositor, with its output where it can be read.
#
# sway sends the stdio of anything it `exec`s to /dev/null, so every line flipctl
# prints about launching apps, reclaiming the panel or failing to do either was
# being thrown away, and the unit's journal showed only sway's own messages. Piping
# through systemd-cat puts them back, under their own tag:
#
#     journalctl -t flipctl -f
exec systemd-cat -t flipctl \
    /home/user/flipctl-slint/target/release/flipper-ui-demo \
    --wayland \
    --remote 0.0.0.0:9999 \
    --assets /home/user/flipctl-slint/crates/flipper-ui/assets/remote
