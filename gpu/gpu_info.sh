#!/usr/bin/env bash
set -euo pipefail

echo "=== GPU/Graphics Stack Diagnostic ==="
echo

########################################
# 1. glxinfo / OpenGL info
########################################

if ! command -v glxinfo >/dev/null 2>&1; then
    echo "[glxinfo] glxinfo not found (install with: sudo apt install mesa-utils)"
    ogl_vendor="unknown"
    ogl_renderer="unknown"
else
    echo "[glxinfo] Running: glxinfo -B"
    echo

    glxinfo_output="$(glxinfo -B 2>&1 || true)"
    echo "$glxinfo_output"

    ogl_vendor="$(printf '%s\n' "$glxinfo_output" | awk -F': ' '/OpenGL vendor string/ {print $2; exit}')"
    ogl_renderer="$(printf '%s\n' "$glxinfo_output" | awk -F': ' '/OpenGL renderer string/ {print $2; exit}')"

    echo
    echo "[glxinfo] Parsed:"
    echo "  OpenGL vendor  : ${ogl_vendor:-unknown}"
    echo "  OpenGL renderer: ${ogl_renderer:-unknown}"
fi

echo
########################################
# 2. DRM / kernel driver info
########################################

echo "=== DRM devices (/sys/class/drm) ==="

if [ -d /sys/class/drm ]; then
    ls -l /sys/class/drm
    echo

    # For each card/render node, show bound driver
    for node in /sys/class/drm/card* /sys/class/drm/renderD*; do
        [ -e "$node" ] || continue
        driver_path=""
        if [ -e "$node/device/driver" ]; then
            driver_path="$(readlink -f "$node/device/driver" 2>/dev/null || true)"
        fi
        driver_name="${driver_path##*/}"
        echo "Node: $(basename "$node")"
        echo "  Device: $(readlink -f "$node/device" 2>/dev/null || echo "unknown")"
        echo "  Driver: ${driver_name:-unknown}"
    done
else
    echo "/sys/class/drm does not exist"
fi

echo
echo "=== Platform GPU-like devices (/sys/bus/platform/devices) ==="

gpu_devices="$(ls /sys/bus/platform/devices 2>/dev/null | grep -iE 'gpu|mali' || true)"
if [ -n "$gpu_devices" ]; then
    printf '%s\n' "$gpu_devices" | sed 's/^/  /'
else
    echo "  (no platform devices matching 'gpu' or 'mali')"
fi

echo
echo "=== Loaded GPU kernel modules (lsmod | egrep 'panfrost|mali') ==="

gpu_modules="$(lsmod | egrep -i '^(panfrost|.*mali.*)' || true)"
if [ -n "$gpu_modules" ]; then
    echo "$gpu_modules"
else
    echo "  (no panfrost or mali modules loaded)"
fi

# Extract a "primary" GPU module name (if any)
gpu_module=""
if printf '%s\n' "$gpu_modules" | grep -qi '^panfrost'; then
    gpu_module="panfrost"
else
    gpu_module="$(printf '%s\n' "$gpu_modules" | awk 'tolower($1) ~ /mali/ {print $1; exit}')"
fi

echo
########################################
# 3. Session type (Xorg vs Wayland)
########################################

echo "=== Session type (Xorg vs Wayland) ==="

session_type="${XDG_SESSION_TYPE:-}"

if [ -z "$session_type" ] && command -v loginctl >/dev/null 2>&1; then
    # Best-effort: pick first active seat/session
    current_session="$(loginctl 2>/dev/null | awk 'NR>1 && $1 ~ /^[0-9]+$/ {print $1; exit}')"
    if [ -n "$current_session" ]; then
        session_type="$(loginctl show-session "$current_session" -p Type 2>/dev/null | cut -d= -f2)"
    fi
fi

if [ -z "$session_type" ]; then
    session_type="unknown"
fi

echo "  XDG_SESSION_TYPE: $session_type"

echo
########################################
# 4. High-level conclusion
########################################

echo "=== Conclusion ==="

# KMS / display driver from card0
kms_driver="unknown"
if [ -e /sys/class/drm/card0/device/driver ]; then
    kms_driver_path="$(readlink -f /sys/class/drm/card0/device/driver 2>/dev/null || true)"
    kms_driver="${kms_driver_path##*/}"
fi

echo "KMS/display driver : $kms_driver"
echo "GPU kernel module  : ${gpu_module:-none}"
echo "GL vendor          : ${ogl_vendor:-unknown}"
echo "GL renderer        : ${ogl_renderer:-unknown}"
echo "Session type       : $session_type"
echo

# Simple logic for a human-readable summary
summary="Unknown graphics configuration."

if echo "${ogl_renderer,,}" | grep -q "llvmpipe"; then
    if [ -z "$gpu_module" ]; then
        summary="No Mali GPU driver in use; system is using software rendering (llvmpipe) on CPU."
    else
        summary="GPU module '$gpu_module' is loaded, but OpenGL is still using software rendering (llvmpipe)."
    fi
elif echo "${ogl_renderer,,}" | grep -q "mali"; then
    if [ "$gpu_module" = "panfrost" ]; then
        summary="Using open-source panfrost driver with Mali GPU for hardware-accelerated rendering."
    elif [ -n "$gpu_module" ]; then
        summary="Using GPU module '$gpu_module' with Mali hardware for accelerated rendering."
    else
        summary="OpenGL renderer reports Mali GPU, but no matching kernel module was detected."
    fi
elif echo "${ogl_renderer,,}" | grep -q "panfrost"; then
    summary="Using open-source panfrost driver for hardware-accelerated rendering."
fi

# Add note about session type
if [ "$session_type" = "x11" ]; then
    summary="$summary Graphics session: Xorg (X11)."
elif [ "$session_type" = "wayland" ]; then
    summary="$summary Graphics session: Wayland (with Xwayland for X apps)."
fi

echo "$summary"
echo

exit 0
