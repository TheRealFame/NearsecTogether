import sys, json, uinput, time

# ── Button + axis layout (same kernel codes for all controllers) ─────────────
# Vendor/product IDs make games show the right button prompts (cross/circle vs A/B)
BTNS = [
    uinput.BTN_A, uinput.BTN_B, uinput.BTN_X, uinput.BTN_Y,
    uinput.BTN_TL, uinput.BTN_TR,
    uinput.BTN_SELECT, uinput.BTN_START,
    uinput.BTN_THUMBL, uinput.BTN_THUMBR,
    uinput.BTN_MODE,
]
AXES = [
    uinput.ABS_X  + (-32767, 32767, 16, 128),
    uinput.ABS_Y  + (-32767, 32767, 16, 128),
    uinput.ABS_RX + (-32767, 32767, 16, 128),
    uinput.ABS_RY + (-32767, 32767, 16, 128),
    uinput.ABS_Z  + (0, 255, 0, 0),     # LT / L2
    uinput.ABS_RZ + (0, 255, 0, 0),     # RT / R2
    uinput.ABS_HAT0X + (-1, 1, 0, 0),   # D-Pad X
    uinput.ABS_HAT0Y + (-1, 1, 0, 0),   # D-Pad Y
]
ALL_EVENTS = BTNS + AXES

# ── Controller profiles ───────────────────────────────────────────────────────
PROFILES = {
    'xbox': {
        'name':    'Microsoft X-Box 360 pad',
        'vendor':  0x045e,
        'product': 0x028e,
    },
    'ps4': {
        'name':    'Sony Interactive Entertainment Wireless Controller',
        'vendor':  0x054c,
        'product': 0x09cc,
    },
    'ps5': {
        'name':    'Sony Interactive Entertainment DualSense Wireless Controller',
        'vendor':  0x054c,
        'product': 0x0ce6,
    },
}

def detect_profile(gpid: str) -> str:
    """Detect controller type from browser gamepad ID string."""
    g = gpid.lower()
    is_sony = any(k in g for k in ['054c', 'sony', 'dualsense', 'dualshock', 'playstation'])
    if is_sony:
        is_ps5 = any(k in g for k in ['0ce6', 'dualsense', 'ps5'])
        return 'ps5' if is_ps5 else 'ps4'
    return 'xbox'

def make_device(profile_key: str):
    p = PROFILES[profile_key]
    return uinput.Device(ALL_EVENTS, name=p['name'], vendor=p['vendor'], product=p['product'])

# ── Start with Xbox 360 as safe default ──────────────────────────────────────
current_profile = 'xbox'
try:
    gp = make_device(current_profile)
    print(f"[input] Virtual device: {PROFILES[current_profile]['name']}", flush=True)
except Exception as e:
    print(f"[input] Failed to create device: {e}", flush=True)
    sys.exit(1)

# ── Main input loop ───────────────────────────────────────────────────────────
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)

        # Controller type detection — reinitialize device if needed
        if msg.get('type') == 'gpid':
            profile = detect_profile(str(msg.get('id', '')))
            if profile != current_profile:
                print(f"[input] Detected: {msg['id']} → switching to {profile}", flush=True)
                try:
                    gp = make_device(profile)
                    current_profile = profile
                    print(f"[input] Now: {PROFILES[profile]['name']}", flush=True)
                except Exception as e:
                    print(f"[input] Device switch failed: {e}", flush=True)
            else:
                print(f"[input] Detected: {profile} (no change)", flush=True)
            continue

        if msg.get('type') == 'gamepad':
            btns = msg.get('buttons', [])
            axes = msg.get('axes', [])

            # Buttons 0-10
            for i in range(min(len(btns), 11)):
                gp.emit(BTNS[i], 1 if btns[i]['pressed'] else 0, syn=False)

            # Left + Right sticks
            if len(axes) >= 4:
                gp.emit(uinput.ABS_X,  axes[0], syn=False)
                gp.emit(uinput.ABS_Y,  axes[1], syn=False)
                gp.emit(uinput.ABS_RX, axes[2], syn=False)
                gp.emit(uinput.ABS_RY, axes[3], syn=False)

            # Analog triggers (from button value 0-255)
            if len(btns) >= 8:
                gp.emit(uinput.ABS_Z,  btns[6]['value'], syn=False)
                gp.emit(uinput.ABS_RZ, btns[7]['value'], syn=False)

            # D-Pad (browser buttons 12=up 13=down 14=left 15=right)
            if len(btns) >= 16:
                hat_x = (1 if btns[15]['pressed'] else 0) - (1 if btns[14]['pressed'] else 0)
                hat_y = (1 if btns[13]['pressed'] else 0) - (1 if btns[12]['pressed'] else 0)
                gp.emit(uinput.ABS_HAT0X, hat_x, syn=False)
                gp.emit(uinput.ABS_HAT0Y, hat_y, syn=False)

            gp.syn()

    except Exception:
        pass
