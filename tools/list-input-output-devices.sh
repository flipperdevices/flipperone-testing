#!/bin/bash
# List display and input devices on Flipper One

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

echo -e "${BOLD}=== Display Devices ===${RESET}\n"

for card_dir in /sys/class/drm/card[0-9]; do
    [ -d "$card_dir/device" ] || continue
    card=$(basename "$card_dir")
    dev="/dev/dri/$card"
    driver=$(grep -oP 'DRIVER=\K.*' "$card_dir/device/uevent" 2>/dev/null)

    # Find connectors for this card
    connectors=()
    for conn_dir in /sys/class/drm/${card}-*; do
        [ -d "$conn_dir" ] || continue
        connectors+=("$conn_dir")
    done

    # Find framebuffer
    fb_name="" fb_dev=""
    for fb_dir in /sys/class/graphics/fb*; do
        [ -d "$fb_dir" ] || continue
        name=$(cat "$fb_dir/name" 2>/dev/null)
        # Match by driver name prefix
        case "$driver" in
            flipper_one_display) [[ "$name" == flipper_one_dis* ]] && fb_dev=$(basename "$fb_dir") && fb_name="$name" ;;
            rockchip-drm)       [[ "$name" == rockchipdrm* ]]     && fb_dev=$(basename "$fb_dir") && fb_name="$name" ;;
        esac
    done

    # Check if this is a render-only device (no connectors)
    if [ ${#connectors[@]} -eq 0 ]; then
        render_node=""
        for rn in /dev/dri/renderD*; do
            rn_card=$(basename "$(readlink -f "/sys/class/drm/$(basename "$rn")/device")" 2>/dev/null)
            dev_card=$(basename "$(readlink -f "$card_dir/device")" 2>/dev/null)
            [ "$rn_card" = "$dev_card" ] && render_node="$rn" && break
        done
        echo -e "  ${CYAN}${dev}${RESET}  ${DIM}${driver}${RESET}"
        echo -e "    Type:       GPU render only (no display outputs)"
        [ -n "$render_node" ] && echo -e "    Render:     ${render_node}"
        echo ""
        continue
    fi

    for conn_dir in "${connectors[@]}"; do
        conn_name=$(basename "$conn_dir")
        conn_type=${conn_name#${card}-}
        status=$(cat "$conn_dir/status" 2>/dev/null)
        modes=$(cat "$conn_dir/modes" 2>/dev/null)

        if [ "$status" = "connected" ]; then
            status_str="${GREEN}connected${RESET}"
        else
            status_str="${RED}disconnected${RESET}"
        fi

        echo -e "  ${CYAN}${dev}${RESET}  ${DIM}${driver}${RESET}"
        echo -e "    Connector:  ${BOLD}${conn_type}${RESET}  ${status_str}"

        if [ -n "$modes" ]; then
            current=$(echo "$modes" | head -1)
            others=$(echo "$modes" | tail -n +2 | tr '\n' ', ' | sed 's/, $//')
            echo -e "    Mode:       ${BOLD}${current}${RESET}${others:+ ${DIM}(also: ${others})${RESET}}"
        fi

        if [ -n "$fb_dev" ]; then
            size=$(cat "/sys/class/graphics/$fb_dev/virtual_size" 2>/dev/null)
            bpp=$(cat "/sys/class/graphics/$fb_dev/bits_per_pixel" 2>/dev/null)
            stride=$(cat "/sys/class/graphics/$fb_dev/stride" 2>/dev/null)
            echo -e "    Framebuffer: /dev/${fb_dev}  ${DIM}(${fb_name}, ${size}, ${bpp}bpp, stride ${stride})${RESET}"
        fi

        echo ""
    done
done

echo -e "${BOLD}=== Input Devices ===${RESET}\n"

while IFS= read -r line; do
    if [[ "$line" =~ ^I:\ Bus=([0-9a-f]+)\ Vendor=([0-9a-f]+)\ Product=([0-9a-f]+) ]]; then
        bus="${BASH_REMATCH[1]}" vendor="${BASH_REMATCH[2]}" product="${BASH_REMATCH[3]}"
    elif [[ "$line" =~ ^N:\ Name=\"(.*)\" ]]; then
        name="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^P:\ Phys=(.*) ]]; then
        phys="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^H:\ Handlers=(.*) ]]; then
        handlers="${BASH_REMATCH[1]}"
        # Find event device
        event=""
        for h in $handlers; do
            [[ "$h" == event* ]] && event="$h" && break
        done
        # Determine bus type
        case "$bus" in
            0003) bus_type="USB" ;;
            0019) bus_type="Platform" ;;
            0011) bus_type="I2C" ;;
            0018) bus_type="I2C" ;;
            0001) bus_type="PCI" ;;
            0005) bus_type="Bluetooth" ;;
            *)    bus_type="Bus:$bus" ;;
        esac

        echo -e "  ${CYAN}/dev/input/${event}${RESET}  ${DIM}${vendor}:${product}${RESET}"
        echo -e "    Name:  ${BOLD}${name}${RESET}"
        echo -e "    Type:  ${bus_type}  ${DIM}(${phys})${RESET}"

        # Show capabilities from handlers
        caps=""
        [[ "$handlers" == *kbd* ]]   && caps+="keyboard "
        [[ "$handlers" == *mouse* ]] && caps+="mouse "
        [[ "$handlers" == *js* ]]    && caps+="joystick "
        [ -n "$caps" ] && echo -e "    Caps:  ${caps}"

        echo ""
    fi
done < /proc/bus/input/devices
