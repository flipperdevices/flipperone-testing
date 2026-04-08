#!/usr/bin/env bash
set -euo pipefail

echo "=== System Information ==="
echo

# Kernel version
kernel_ver="$(uname -r)"
echo "Kernel version : $kernel_ver"

# Hostname
hostname_val="$(hostname)"
echo "Hostname       : $hostname_val"

# Distro name
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "Distro         : ${PRETTY_NAME:-$NAME $VERSION_ID}"
else
    echo "Distro         : (no /etc/os-release found)"
fi

echo
########################################
# 1. DRM devices & drivers
########################################

echo "=== DRM Devices ==="
echo

if [ -d /sys/class/drm ]; then
    for node in /sys/class/drm/card[0-9]*; do
        [ -e "$node" ] || continue
        # Skip connector sub-nodes (e.g. card2-HDMI-A-1), only show card devices
        basename_node="$(basename "$node")"
        case "$basename_node" in
            card[0-9]*-*) continue ;;
        esac

        driver_name="unknown"
        if [ -e "$node/device/driver" ]; then
            driver_path="$(readlink -f "$node/device/driver" 2>/dev/null || true)"
            driver_name="${driver_path##*/}"
        fi

        device_path="$(readlink -f "$node/device" 2>/dev/null || echo "unknown")"

        # List connectors for this card
        connectors=""
        for conn in /sys/class/drm/${basename_node}-*/; do
            [ -d "$conn" ] || continue
            conn_name="$(basename "$conn")"
            conn_name="${conn_name#${basename_node}-}"
            connectors="${connectors} ${conn_name}"
        done

        echo "  $basename_node"
        echo "    Driver     : $driver_name"
        echo "    Device     : $device_path"
        if [ -n "$connectors" ]; then
            echo "    Connectors :$connectors"
        fi
        echo
    done

    # Show render nodes separately
    for node in /sys/class/drm/renderD*; do
        [ -e "$node" ] || continue
        driver_name="unknown"
        if [ -e "$node/device/driver" ]; then
            driver_path="$(readlink -f "$node/device/driver" 2>/dev/null || true)"
            driver_name="${driver_path##*/}"
        fi
        echo "  $(basename "$node")"
        echo "    Driver     : $driver_name"
        echo
    done
else
    echo "  /sys/class/drm does not exist"
fi

########################################
# 2. Connected monitors
########################################

echo "=== Connected Monitors ==="
echo

monitor_count=0

for conn in /sys/class/drm/card*-*/; do
    [ -d "$conn" ] || continue
    name="$(basename "$conn")"
    status="$(cat "$conn/status" 2>/dev/null || echo "unknown")"

    # Parse connector type and index from name (e.g. card2-HDMI-A-1 -> HDMI-A-1)
    connector="${name#card*-}"

    # Find which card this connector belongs to
    card_name="${name%%-*}"
    card_driver="unknown"
    if [ -e "/sys/class/drm/${card_name}/device/driver" ]; then
        card_driver_path="$(readlink -f "/sys/class/drm/${card_name}/device/driver" 2>/dev/null || true)"
        card_driver="${card_driver_path##*/}"
    fi

    echo "  $connector ($card_driver)"
    echo "    Status    : $status"

    if [ "$status" = "connected" ]; then
        monitor_count=$((monitor_count + 1))

        # Show available modes (first = preferred/current)
        if [ -f "$conn/modes" ] && [ -s "$conn/modes" ]; then
            current_mode="$(head -1 "$conn/modes")"
            mode_count="$(wc -l < "$conn/modes")"
            echo "    Mode      : $current_mode (${mode_count} modes available)"
        else
            echo "    Mode      : (no modes listed)"
        fi

        # Read EDID — sysfs files report size 0 so -s won't work; read and check
        edid_data=""
        if [ -f "$conn/edid" ]; then
            edid_data="$(cat "$conn/edid" 2>/dev/null | od -A n -t x1 -N 1 || true)"
        fi

        if [ -n "${edid_data// /}" ]; then
            # Parse monitor name directly from EDID binary (descriptor tag 0xFC)
            monitor_name="$(cat "$conn/edid" 2>/dev/null \
                | python3 -c "
import sys
edid = sys.stdin.buffer.read()
if len(edid) >= 128:
    # Manufacturer ID from bytes 8-9
    import struct
    val = struct.unpack('>H', edid[8:10])[0]
    mfr = chr(((val>>10)&0x1F)+64) + chr(((val>>5)&0x1F)+64) + chr((val&0x1F)+64)
    # Find monitor name descriptor (tag 0xFC)
    name = ''
    for i in range(54, 126, 18):
        if edid[i:i+3] == b'\x00\x00\x00' and edid[i+3] == 0xFC:
            name = edid[i+5:i+18].split(b'\x0a')[0].decode('ascii', errors='replace').strip()
            break
    if name:
        print(f'{name} ({mfr})')
    else:
        print(mfr)
" 2>/dev/null || true)"
            if [ -n "$monitor_name" ]; then
                echo "    Monitor   : $monitor_name"
            fi
            echo "    EDID      : present"
        else
            echo "    EDID      : not available"
        fi

        # Show dpms state if available
        if [ -f "$conn/dpms" ]; then
            echo "    DPMS      : $(cat "$conn/dpms" 2>/dev/null)"
        fi

        # Show enabled state
        if [ -f "$conn/enabled" ]; then
            echo "    Enabled   : $(cat "$conn/enabled" 2>/dev/null)"
        fi
    fi
    echo
done

echo "  Total connected: $monitor_count"

echo
########################################
# 3. Display session
########################################

echo "=== Display Session ==="

session_type="${XDG_SESSION_TYPE:-}"

# When run via sudo, XDG_SESSION_TYPE is lost and loginctl may not find
# the invoking user's session. Try multiple detection methods.
if [ -z "$session_type" ] && command -v loginctl >/dev/null 2>&1; then
    # Try the invoking user's session first (handles sudo)
    real_user="${SUDO_USER:-}"
    if [ -n "$real_user" ]; then
        current_session="$(loginctl list-sessions --no-legend 2>/dev/null \
            | awk -v u="$real_user" '$3 == u {print $1; exit}')"
    fi
    # Fall back to any active session
    if [ -z "${current_session:-}" ]; then
        current_session="$(loginctl list-sessions --no-legend 2>/dev/null \
            | awk '{print $1; exit}')"
    fi
    if [ -n "${current_session:-}" ]; then
        session_type="$(loginctl show-session "$current_session" -p Type --value 2>/dev/null || true)"
    fi
fi

# Fall back: detect from running processes
if [ -z "$session_type" ]; then
    if [ -n "${SSH_CONNECTION:-}" ] || [ -n "${SSH_TTY:-}" ]; then
        session_type="tty (SSH)"
    else
        session_type="unknown"
    fi
fi

echo "  Session type     : $session_type"

# Detect display server / compositor
display_manager=""
if pgrep -x sddm >/dev/null 2>&1; then
    display_manager="sddm"
elif pgrep -x gdm >/dev/null 2>&1 || pgrep -x gdm3 >/dev/null 2>&1; then
    display_manager="gdm"
elif pgrep -x lightdm >/dev/null 2>&1; then
    display_manager="lightdm"
fi
if [ -n "$display_manager" ]; then
    echo "  Display manager  : $display_manager"
fi

compositor=""
if pgrep -f kwin_wayland >/dev/null 2>&1; then
    compositor="KWin (Wayland)"
elif pgrep -x sway >/dev/null 2>&1; then
    compositor="Sway"
elif pgrep -x weston >/dev/null 2>&1; then
    compositor="Weston"
elif pgrep -x mutter >/dev/null 2>&1; then
    compositor="Mutter (GNOME Wayland)"
elif pgrep -x Xorg >/dev/null 2>&1 || pgrep -x X >/dev/null 2>&1; then
    compositor="Xorg"
fi
if [ -n "$compositor" ]; then
    echo "  Compositor       : $compositor"
fi

if pgrep -x Xwayland >/dev/null 2>&1; then
    echo "  Xwayland         : running"
fi

echo
########################################
# 4. Display resolution & refresh rate
########################################

echo "=== Display Resolution ==="

display_info=""

if command -v xrandr >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    display_info="$(xrandr --current 2>/dev/null | awk '/\*/{print $1 " @ " $2 " Hz"}' || true)"
fi

if [ -n "$display_info" ]; then
    echo "  $display_info"
else
    # Fall back to DRM modes for connected outputs
    drm_modes=""
    for conn in /sys/class/drm/card*-*/; do
        [ -d "$conn" ] || continue
        status="$(cat "$conn/status" 2>/dev/null || echo "")"
        if [ "$status" = "connected" ] && [ -f "$conn/modes" ] && [ -s "$conn/modes" ]; then
            connector="$(basename "$conn")"
            connector="${connector#card*-}"
            mode="$(head -1 "$conn/modes")"
            drm_modes="${drm_modes}  ${connector}: ${mode}\n"
        fi
    done
    if [ -n "$drm_modes" ]; then
        printf '%b' "$drm_modes"
    else
        echo "  (no active displays detected)"
    fi
fi

echo
########################################
# 5. Summary
########################################

echo "=== Summary ==="

# Collect KMS drivers from all cards
kms_drivers=""
for node in /sys/class/drm/card[0-9]*; do
    [ -e "$node" ] || continue
    basename_node="$(basename "$node")"
    case "$basename_node" in
        card[0-9]*-*) continue ;;
    esac
    if [ -e "$node/device/driver" ]; then
        drv_path="$(readlink -f "$node/device/driver" 2>/dev/null || true)"
        drv="${drv_path##*/}"
        # Check if this card has any connected outputs
        has_connected=""
        for conn in /sys/class/drm/${basename_node}-*/; do
            [ -d "$conn" ] || continue
            st="$(cat "$conn/status" 2>/dev/null || echo "")"
            if [ "$st" = "connected" ]; then
                has_connected="yes"
                break
            fi
        done
        if [ -n "$has_connected" ]; then
            kms_drivers="${kms_drivers}${drv} (${basename_node}, active) "
        else
            kms_drivers="${kms_drivers}${drv} (${basename_node}) "
        fi
    fi
done

echo "Display drivers    : ${kms_drivers:-unknown}"
echo "Session type       : $session_type"
[ -n "$compositor" ] && echo "Compositor         : $compositor"
echo "Connected monitors : $monitor_count"

# GPU driver status
panfrost_bound="$(ls /sys/bus/platform/drivers/panfrost 2>/dev/null | head -1 || true)"
if [ -n "$panfrost_bound" ]; then
    echo "GPU driver         : panfrost (built-in)"
fi

echo

exit 0
