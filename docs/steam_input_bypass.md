# Steam Input Bypass Guide

Virtual controllers created by Nearsec Together (via `uinput`) can be intercepted
by Steam Input, causing doubled or remapped inputs. Here are the options to fix this
**without** turning Steam Input off globally.

---

## Option A — Per-game launch option (Recommended, zero setup)

In Steam, right-click your game → **Properties** → **Launch Options**, and add:

```
SDL_GAMECONTROLLER_IGNORE_DEVICES=0x045e/0x028e,0x054c/0x09cc,0x054c/0x0ce6 %command%
```

This tells SDL (which Steam uses internally) to ignore our specific emulated VID:PID
combinations. The game sees the raw uinput event device directly.

**VID:PIDs covered:**
| VID:PID | Device |
|---------|--------|
| `045e:028e` | Microsoft X-Box 360 pad (default emulated) |
| `054c:09cc` | Sony DualShock 4 Wireless Controller |
| `054c:0ce6` | Sony DualSense (PS5) |

---

## Option B — udev rule (System-wide, permanent fix)

Run this once to install a udev rule that tells Steam not to treat our virtual devices
as Steam Input candidates:

```bash
sudo tee /etc/udev/rules.d/99-nearsec-virtual-gamepad.rules > /dev/null << 'EOF'
# Nearsec Together — virtual gamepad bypass for Steam Input
# Matches our emulated Xbox 360, DS4, and DualSense VID:PIDs
# TAG+="uaccess" lets the current user read the device.
# ENV{ID_INPUT_JOYSTICK}="1" keeps it visible as a joystick.
# The absence of the steam-udev-rule "steam" tag prevents Steam
# from routing these through Steam Input.

SUBSYSTEM=="input", ATTRS{idVendor}=="045e", ATTRS{idProduct}=="028e", TAG+="uaccess"
SUBSYSTEM=="input", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="09cc", TAG+="uaccess"
SUBSYSTEM=="input", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="0ce6", TAG+="uaccess"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger
```

After restarting the server the new virtual devices will be tagged correctly.

---

## Option C — Disable Steam Input for a single controller slot

In Steam Big Picture / Steam Input settings, you can disable Steam Input per-controller
type (e.g., "Xbox Configuration Support") while leaving your real controller's Steam
Input enabled. This is less precise than Options A/B.

---

## Why this happens

Steam's udev helper (`/lib/udev/rules.d/60-steam-input.rules`) matches devices by
VID:PID and routes them through Steam Input before the game sees them. Our emulated
devices use real hardware VID:PIDs (Xbox 360, DS4, DualSense) for button prompt
compatibility — which means Steam recognizes and intercepts them.

Options A and B prevent that interception for our specific emulated devices only.
