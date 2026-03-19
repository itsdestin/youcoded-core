#!/bin/bash
# done-sound.sh: Stop hook — play a short sound when Claude finishes responding.
# macOS: uses afplay with a system sound.
# Linux: uses paplay (PulseAudio) or aplay as fallback.
# Other platforms: exits silently.

if [[ "$(uname)" == "Darwin" ]]; then
  afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
elif command -v paplay &>/dev/null; then
  paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
elif command -v aplay &>/dev/null; then
  aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null || true
fi

exit 0
