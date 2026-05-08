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

# ── Deadzone: ignore joystick noise below this threshold (out of 32767) ──────
# Prevents phantom left/right/up/down when stick rests near center.
AXIS_DEADZONE = 1800  # ~5.5% of full range

# ── Controller profiles ───────────────────────────────────────────────────────
PROFILES = {
    'xbox': {
        'name':    'Microsoft X-Box 360 pad',
        'vendor':  0x045e,
        'product': 0x028e,
        'version': 0x0114,  # required for correct SDL/Steam mapping
        'bustype': 0x0003,  # USB
    },
    'xboxone': {
        'name':    'Microsoft Xbox One S Pad',
        'vendor':  0x045e,
        'product': 0x02ea,
        'version': 0x0301,
        'bustype': 0x0003,
    },
    'xboxseries': {
        'name':    'Microsoft Xbox Series S|X Controller',
        'vendor':  0x045e,
        'product': 0x0b12,
        'version': 0x0507,
        'bustype': 0x0003,
    },
    'ps4': {
        'name':    'Sony Interactive Entertainment Wireless Controller',
        'vendor':  0x054c,
        'product': 0x09cc,
        'version': 0x0100,
        'bustype': 0x0003,
    },
    'ps5': {
        'name':    'Sony Interactive Entertainment DualSense Wireless Controller',
        'vendor':  0x054c,
        'product': 0x0ce6,
        'version': 0x0100,
        'bustype': 0x0003,
    },
}

def detect_profile(gpid: str) -> str:
    """Detect controller type from browser gamepad ID string."""
    g = gpid.lower()
    
    # Sony detection
    is_sony = any(k in g for k in ['054c', 'sony', 'dualsense', 'dualshock', 'playstation'])
    if is_sony:
        is_ps5 = any(k in g for k in ['0ce6', 'dualsense', 'ps5'])
        return 'ps5' if is_ps5 else 'ps4'
    
    # Xbox Series detection (0b12)
    if '0b12' in g or 'xbox series' in g:
        return 'xboxseries'
        
    # Xbox One detection (02ea, 02d1, 02fd, 02dd, etc)
    is_xbox_one = any(k in g for k in ['xbox one', '02ea', '02d1', '02fd', '02dd', '0291'])
    if is_xbox_one:
        return 'xboxone'
        
    # Original Xbox / 360 / Fallback
    # Original Xbox usually shows as '045e' and '0202' or '0285' or '0289'
    return 'xbox'

def make_device(profile_key: str):
    p = PROFILES[profile_key]
    return uinput.Device(
        ALL_EVENTS,
        name=p['name'],
        vendor=p['vendor'],
        product=p['product'],
        version=p.get('version', 0x0100),
        bustype=p.get('bustype', 0x0003),
    )

def apply_deadzone(value: int, deadzone: int) -> int:
    """Return 0 if |value| is within deadzone, otherwise return value as-is."""
    return 0 if abs(value) < deadzone else value

def flush_neutral_for_device(gp):
    """Emit a fully-zeroed (neutral) state to prevent stuck inputs."""
    try:
        for btn in BTNS:
            gp.emit(btn, 0, syn=False)
        gp.emit(uinput.ABS_X,     0, syn=False)
        gp.emit(uinput.ABS_Y,     0, syn=False)
        gp.emit(uinput.ABS_RX,    0, syn=False)
        gp.emit(uinput.ABS_RY,    0, syn=False)
        gp.emit(uinput.ABS_Z,     0, syn=False)
        gp.emit(uinput.ABS_RZ,    0, syn=False)
        gp.emit(uinput.ABS_HAT0X, 0, syn=False)
        gp.emit(uinput.ABS_HAT0Y, 0, syn=False)
        gp.syn()
    except Exception:
        pass

# ── Dynamic device manager ───────────────────────────────────────────────────
devices = {}
device_profiles = {}

# ── Main input loop ───────────────────────────────────────────────────────────
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)

        # ── flush_neutral: zero out all inputs for this viewer before disconnect ──
        if msg.get('type') == 'flush_neutral':
            vid = str(msg.get('viewer_id', ''))
            for k, gp in list(devices.items()):
                if str(k).startswith(vid + '_') or str(k) == vid:
                    print(f"[input] Flushing neutral state for {k}", flush=True)
                    flush_neutral_for_device(gp)
            continue

        # ── disconnect_viewer: destroy all gamepads for this viewer ──────────────
        if msg.get('type') == 'disconnect_viewer':
            vid = str(msg.get('viewer_id', ''))
            keys_to_delete = [k for k in devices.keys() if str(k).startswith(vid + '_') or str(k) == vid]
            for k in keys_to_delete:
                print(f"[input] Cleaning up device {k}", flush=True)
                del devices[k]
                if k in device_profiles:
                    del device_profiles[k]
            continue

        pad_id = str(msg.get('pad_id', 'default'))

        # ── Controller type detection — reinitialize device if needed ────────────
        if msg.get('type') == 'gpid':
            profile = detect_profile(str(msg.get('id', '')))
            if pad_id not in device_profiles or device_profiles[pad_id] != profile:
                print(f"[input] [{pad_id}] Detected: {msg['id']} → switching to {profile}", flush=True)
                try:
                    devices[pad_id] = make_device(profile)
                    device_profiles[pad_id] = profile
                    print(f"[input] [{pad_id}] Now: {PROFILES[profile]['name']}", flush=True)
                except Exception as e:
                    print(f"[input] [{pad_id}] Device switch failed: {e}", flush=True)
            continue

        if msg.get('type') == 'gamepad':
            # Create a default device if they start sending inputs before gpid
            if pad_id not in devices:
                try:
                    devices[pad_id] = make_device('xbox')
                    device_profiles[pad_id] = 'xbox'
                    print(f"[input] [{pad_id}] Auto-created fallback Xbox device", flush=True)
                except Exception as e:
                    print(f"[input] [{pad_id}] Fallback device failed: {e}", flush=True)
                    continue

            gp = devices[pad_id]
            btns = msg.get('buttons', [])
            axes = msg.get('axes', [])

            # Buttons 0-10
            for i in range(min(len(btns), 11)):
                gp.emit(BTNS[i], 1 if btns[i]['pressed'] else 0, syn=False)

            # Left + Right sticks — apply deadzone to prevent phantom drift
            if len(axes) >= 4:
                gp.emit(uinput.ABS_X,  apply_deadzone(axes[0], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_Y,  apply_deadzone(axes[1], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_RX, apply_deadzone(axes[2], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_RY, apply_deadzone(axes[3], AXIS_DEADZONE), syn=False)

            # Analog triggers (already scaled to 0-255 in index.html)
            if len(btns) >= 8:
                gp.emit(uinput.ABS_Z,  btns[6].get('value', 0), syn=False)
                gp.emit(uinput.ABS_RZ, btns[7].get('value', 0), syn=False)

            # D-Pad (browser buttons 12=up 13=down 14=left 15=right)
            # The browser Gamepad API can report the hat as floating-point axes (on some
            # browsers/controllers) which produces non-integer values causing spam.
            # We clamp to strict -1/0/1 integers only.
            if len(btns) >= 16:
                hat_x = (1 if btns[15]['pressed'] else 0) - (1 if btns[14]['pressed'] else 0)
                hat_y = (1 if btns[13]['pressed'] else 0) - (1 if btns[12]['pressed'] else 0)
                # Clamp to valid range — prevents values outside [-1,1]
                hat_x = max(-1, min(1, hat_x))
                hat_y = max(-1, min(1, hat_y))
                gp.emit(uinput.ABS_HAT0X, hat_x, syn=False)
                gp.emit(uinput.ABS_HAT0Y, hat_y, syn=False)

            gp.syn()

    except Exception:
        pass
