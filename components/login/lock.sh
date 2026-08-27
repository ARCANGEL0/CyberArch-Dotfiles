#!/usr/bin/env bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-$(loginctl show-session $(loginctl | grep $(whoami) | awk '{print $1}') -p Type --value 2>/dev/null || echo wayland)}"
export QT_MEDIA_BACKEND=ffmpeg
export QS_THEME="netwatch"
export QS_THEME_PATH="$DIR/themes/$QS_THEME"
export XCURSOR_THEME="neurodance"
export XCURSOR_SIZE=48

### fix for lock 
if [ -z "${WAYLAND_DISPLAY:-}" ] && command -v wlr-randr >/dev/null 2>&1; then
    for socket in "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/wayland-[0-9]*; do
        [ -S "$socket" ] || continue
        candidate="${socket##*/}"
        if WAYLAND_DISPLAY="$candidate" wlr-randr >/dev/null 2>&1; then
            export WAYLAND_DISPLAY="$candidate"
            break
        fi
    done
fi

killall -9 hyprlock swaylock wlogout 2>/dev/null || true

exec quickshell -p "$DIR/lock_shell.qml"
