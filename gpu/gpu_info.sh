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
# 5. Software stack versions
#    Bottom-up walk through the graphics stack layers:
#      hardware -> kernel DRM -> libdrm -> Mesa (Panfrost/PanVK)
#      -> Vulkan loader -> compositor
########################################

echo "=== Software Stack Versions ==="
echo

# -- helpers --
have() { command -v "$1" >/dev/null 2>&1; }
pkg_ver() { dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true; }
trim() { sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }

# ---------- [1] Hardware: Mali GPU identity ----------
echo "[Hardware — Mali GPU]"

# Device-tree compatible string ("arm,mali-bifrost", "rockchip,rk3576-mali", etc.)
gpu_dt=""
for n in /proc/device-tree/gpu* /proc/device-tree/soc*/gpu* /proc/device-tree/soc*/gpu@*; do
    [ -d "$n" ] || continue
    if [ -f "$n/compatible" ]; then
        gpu_dt="$(tr '\0' ' ' < "$n/compatible" | sed 's/  */ /g' | trim)"
        break
    fi
done
[ -n "$gpu_dt" ] && printf "  %-17s: %s\n" "DT compatible" "$gpu_dt"

# Try kernel ring buffer first, then journalctl (in case buffer rolled over)
panfrost_log="$(dmesg 2>/dev/null | grep -E 'panfrost.*[0-9a-f]+\.gpu' || true)"
if [ -z "$panfrost_log" ] && have journalctl; then
    panfrost_log="$(journalctl -k --no-pager 2>/dev/null | grep -E 'panfrost.*[0-9a-f]+\.gpu' || true)"
fi

if [ -n "$panfrost_log" ]; then
    identity="$(echo "$panfrost_log" | grep -i 'IDENTITY' | head -1 | grep -oE '0x[0-9a-fA-F]+' | head -1 || true)"
    [ -n "$identity" ] && printf "  %-17s: %s\n" "GPU IDENTITY" "$identity"

    shader_present="$(echo "$panfrost_log" | grep -i 'shader_present' | head -1 | grep -oE '0x[0-9a-fA-F]+' | head -1 || true)"
    if [ -n "$shader_present" ] && have python3; then
        cores="$(python3 -c "print(bin($shader_present).count('1'))" 2>/dev/null || echo "?")"
        printf "  %-17s: %s (shader_present=%s)\n" "Shader cores" "$cores" "$shader_present"
    fi

    clock_hz="$(echo "$panfrost_log" | grep -i 'clock rate' | head -1 | sed -E 's/.*=[[:space:]]*([0-9]+).*/\1/' || true)"
    if [ -n "$clock_hz" ]; then
        printf "  %-17s: %s MHz (at probe)\n" "Clock rate" "$((clock_hz / 1000000))"
    fi
else
    echo "  (kernel log unreadable as user — run with sudo for GPU IDENTITY / shader cores)"
fi
echo

# ---------- [2] Kernel — DRM/GPU drivers ----------
echo "[Kernel — DRM/GPU drivers]"
printf "  %-17s: %s\n" "Kernel" "$kernel_ver"
for m in panfrost panthor rockchip_drm_vop2 rockchip_drm drm drm_kms_helper; do
    if [ -d "/sys/module/$m" ]; then
        state="loaded"
        [ -f "/sys/module/$m/initstate" ] && state="$(cat "/sys/module/$m/initstate")"
        srcv=""
        if [ -f "/sys/module/$m/srcversion" ]; then
            srcv="$(cat "/sys/module/$m/srcversion")"
        fi
        printf "  %-17s: %s%s\n" "$m" "$state" "${srcv:+ (srcversion ${srcv:0:12})}"
    fi
done
echo

# ---------- [3] libdrm — DRM userspace bindings ----------
echo "[libdrm — userspace DRM bindings]"
found_libdrm=0
for p in libdrm2 libdrm-common; do
    v="$(pkg_ver "$p")"
    if [ -n "$v" ]; then
        printf "  %-17s: %s\n" "$p" "$v"
        found_libdrm=1
    fi
done
if have pkg-config; then
    libdrm_pc="$(pkg-config --modversion libdrm 2>/dev/null || true)"
    [ -n "$libdrm_pc" ] && printf "  %-17s: %s\n" "libdrm (pkg-cfg)" "$libdrm_pc"
fi
[ "$found_libdrm" -eq 0 ] && echo "  (libdrm package info unavailable — non-dpkg system?)"
echo

# ---------- [4] Mesa — userspace GL/Vulkan drivers ----------
echo "[Mesa — userspace GL/Vulkan drivers]"
# Package-level versions (cheap, always works on Debian)
for p in libgl1-mesa-dri mesa-vulkan-drivers libegl-mesa0 libegl1-mesa libglapi-mesa libgles2-mesa mesa-utils mesa-utils-extra; do
    v="$(pkg_ver "$p")"
    [ -n "$v" ] && printf "  %-17s: %s\n" "$p" "$v"
done

# GL/GLES runtime info via eglinfo (works headless via surfaceless/gbm platforms)
if have eglinfo; then
    egl_out="$(eglinfo 2>/dev/null || true)"
    if [ -n "$egl_out" ]; then
        gl_renderer="$(echo "$egl_out" | grep -m1 -iE '^[[:space:]]*opengl( es)?( profile)? renderer' | sed 's/.*: //' | trim)"
        gl_version="$(echo "$egl_out"  | grep -m1 -iE '^[[:space:]]*opengl( es)?( profile)? version'  | sed 's/.*: //' | trim)"
        egl_driver="$(echo "$egl_out"  | grep -m1 -iE 'EGL driver name' | sed 's/.*: //' | trim)"
        [ -n "$egl_driver"  ] && printf "  %-17s: %s\n" "EGL driver"  "$egl_driver"
        [ -n "$gl_renderer" ] && printf "  %-17s: %s\n" "GL renderer" "$gl_renderer"
        [ -n "$gl_version"  ] && printf "  %-17s: %s\n" "GL version"  "$gl_version"
    fi
else
    echo "  (install 'mesa-utils-extra' for eglinfo → GL renderer/version)"
fi

# Vulkan runtime info via vulkaninfo (Vulkan is display-server agnostic, works over SSH)
if have vulkaninfo; then
    vk_summary="$(vulkaninfo --summary 2>/dev/null || true)"
    if [ -n "$vk_summary" ]; then
        for field in driverName driverInfo deviceName apiVersion driverID; do
            val="$(echo "$vk_summary" | grep -m1 "$field" | sed 's/.*= //' | trim)"
            [ -n "$val" ] && printf "  %-17s: %s\n" "Vulkan $field" "$val"
        done
    fi
else
    echo "  (install 'vulkan-tools' for vulkaninfo → Vulkan driver/version)"
fi
echo

# ---------- [5] Vulkan loader & registered ICDs ----------
echo "[Vulkan loader]"
for p in libvulkan1 vulkan-tools vulkan-validationlayers; do
    v="$(pkg_ver "$p")"
    [ -n "$v" ] && printf "  %-17s: %s\n" "$p" "$v"
done

icd_files=()
for d in /usr/share/vulkan/icd.d /etc/vulkan/icd.d /usr/local/share/vulkan/icd.d \
         "${XDG_CONFIG_HOME:-$HOME/.config}/vulkan/icd.d"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.json; do
        [ -e "$f" ] || continue
        icd_files+=("$(basename "$f")")
    done
done
if [ ${#icd_files[@]} -gt 0 ]; then
    printf "  %-17s: %s\n" "Registered ICDs" "${icd_files[*]}"
fi
echo

# ---------- [6] Compositor / display server ----------
echo "[Compositor / Display server]"
get_first_ver() {
    # Run a binary's version flag; print whatever looks like a version on line 1
    local cmd="$1" flag="${2:---version}"
    "$cmd" "$flag" 2>&1 | head -1 | awk '{print $NF}'
}
if have kwin_wayland; then
    printf "  %-17s: %s\n" "KWin (Wayland)" "$(get_first_ver kwin_wayland)"
fi
if have plasmashell; then
    printf "  %-17s: %s\n" "plasmashell"    "$(get_first_ver plasmashell)"
fi
if have sddm; then
    printf "  %-17s: %s\n" "SDDM"           "$(get_first_ver sddm)"
fi
if have Xwayland; then
    # Xwayland prints "X.Org X Server 24.x.x" — grab last token
    xwl_ver="$(Xwayland -version 2>&1 | grep -m1 -i 'x server' | awk '{print $NF}')"
    [ -z "$xwl_ver" ] && xwl_ver="$(Xwayland -version 2>&1 | head -1 | awk '{print $NF}')"
    printf "  %-17s: %s\n" "Xwayland" "$xwl_ver"
fi
for p in libwayland-client0 libwayland-server0 wayland-protocols; do
    v="$(pkg_ver "$p")"
    [ -n "$v" ] && printf "  %-17s: %s\n" "$p" "$v"
done

echo
########################################
# 6. Summary
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
