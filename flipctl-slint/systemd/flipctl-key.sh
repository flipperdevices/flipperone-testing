#!/bin/sh
# Hand one key press to flipctl, by name.
#
# A press is a down *and* an up. Sending only the down is what made the second
# press of the same key vanish: flipctl still had the first one held, which is why
# Tab worked once and then did nothing, while the browser view, which sends both,
# worked every time.
#
# A script rather than the curl line in sway's config, because the payload is JSON
# and sway's parser reads braces as block delimiters: putting them in a `bindsym
# exec` broke the parse from that line on, and the `exec` that starts flipctl was
# never reached.
#
# Names are flipctl's own wire names, from FlipperKey::name: back, appsw, esc,
# view, power, edit, run, up, down, left, right, ok, ptt.
poke() {
    curl -s -o /dev/null --max-time 1 -X POST \
        "http://127.0.0.1:9999/input" \
        -d "\"key\":\"$1\",\"down\":$2"
}
poke "$1" true
poke "$1" false
