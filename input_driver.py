import sys, json, uinput, time, os

# ── 1. Gamepad Layout ────────────────────────────────────────────────────────
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

# ── 2. Keyboard & Mouse Layout ───────────────────────────────────────────────
# We map a large chunk of standard gaming keys here so uinput creates a device
# capable of accepting them if Raw KBM mode is used.
KBM_EVENTS = [
    uinput.REL_X, uinput.REL_Y, uinput.REL_WHEEL,
    uinput.BTN_LEFT, uinput.BTN_RIGHT, uinput.BTN_MIDDLE,
    uinput.KEY_W, uinput.KEY_A, uinput.KEY_S, uinput.KEY_D,
    uinput.KEY_UP, uinput.KEY_DOWN, uinput.KEY_LEFT, uinput.KEY_RIGHT,
    uinput.KEY_SPACE, uinput.KEY_ENTER, uinput.KEY_ESC,
    uinput.KEY_LEFTSHIFT, uinput.KEY_LEFTCTRL, uinput.KEY_TAB,
    uinput.KEY_Q, uinput.KEY_E, uinput.KEY_R, uinput.KEY_F, uinput.KEY_C,
    uinput.KEY_Z, uinput.KEY_X, uinput.KEY_V, uinput.KEY_B, uinput.KEY_1, uinput.KEY_2
]

ALL_EVENTS = BTNS + AXES + KBM_EVENTS
AXIS_DEADZONE = 1800
force_xboxone = True

# ── 3. Load or Generate KBM Bindings ────────────────────────────────────────
BINDINGS_FILE = "kbm_bindings.json"
DEFAULT_BINDINGS = {
    "buttons": {
        "KEY_SPACE": "BTN_A",
        "KEY_LEFTSHIFT": "BTN_B",
        "KEY_E": "BTN_X",
        "KEY_R": "BTN_Y",
        "KEY_Q": "BTN_TL",
        "KEY_C": "BTN_TR",
        "KEY_F": "BTN_SELECT",
        "KEY_ENTER": "BTN_START"
    },
    "left_stick": {
        "KEY_W": {"axis": "ABS_Y", "val": -32767},
        "KEY_S": {"axis": "ABS_Y", "val": 32767},
        "KEY_A": {"axis": "ABS_X", "val": -32767},
        "KEY_D": {"axis": "ABS_X", "val": 32767}
    },
    "dpad": {
        "KEY_UP": {"axis": "ABS_HAT0Y", "val": -1},
        "KEY_DOWN": {"axis": "ABS_HAT0Y", "val": 1},
        "KEY_LEFT": {"axis": "ABS_HAT0X", "val": -1},
        "KEY_RIGHT": {"axis": "ABS_HAT0X", "val": 1}
    },
    "right_stick_mouse": True,
    "right_stick_multiplier": 1500
}

if not os.path.exists(BINDINGS_FILE):
    with open(BINDINGS_FILE, 'w') as f:
        json.dump(DEFAULT_BINDINGS, f, indent=4)
    kbm_binds = DEFAULT_BINDINGS
    print(f"[input] Created default {BINDINGS_FILE}", flush=True)
else:
    try:
        with open(BINDINGS_FILE, 'r') as f:
            kbm_binds = json.load(f)
        print(f"[input] Loaded {BINDINGS_FILE}", flush=True)
    except Exception as e:
        print(f"[input] Error reading {BINDINGS_FILE}, using defaults: {e}", flush=True)
        kbm_binds = DEFAULT_BINDINGS

# ── Profiles ──────────────────────────────────────────────────────────────────
PROFILES = {
    'xbox': { 'name': 'Microsoft X-Box 360 pad', 'vendor': 0x045e, 'product': 0x028e, 'version': 0x0114 },
    'xboxone': { 'name': 'Microsoft Xbox One S Pad', 'vendor': 0x045e, 'product': 0x02ea, 'version': 0x0301 },
    'xboxseries': { 'name': 'Microsoft Xbox Series S|X Controller', 'vendor': 0x045e, 'product': 0x0b12, 'version': 0x0507 },
    'ps4': { 'name': 'Sony DualShock 4 Wireless Controller', 'vendor': 0x054c, 'product': 0x09cc, 'version': 0x0100 },
    'ps5': { 'name': 'Sony DualSense Wireless Controller', 'vendor': 0x054c, 'product': 0x0ce6, 'version': 0x0100 },
}

def detect_profile(gpid: str) -> str:
    g = gpid.lower()
    is_sony = any(k in g for k in ['054c', 'sony', 'dualsense', 'dualshock', 'playstation'])
    if is_sony:
        native = 'ps5' if any(k in g for k in ['0ce6', 'dualsense', 'ps5']) else 'ps4'
        return native if enable_dualshock else 'xboxone'
    if '0b12' in g or 'xbox series' in g: return 'xboxseries'
    if not force_xboxone:
        if any(k in g for k in ['028e', '028f', 'xbox 360']): return 'xbox'
    is_xbox_one = any(k in g for k in ['xbox one', 'xbox wireless', '02ea', '02d1', '02fd', '02dd', '0291', '0b00', '0b05'])
    if is_xbox_one: return 'xboxone'
    return 'xboxone' if force_xboxone else 'xbox'

def make_device(profile_key: str):
    p = PROFILES[profile_key]
    return uinput.Device(ALL_EVENTS, name=p['name'], vendor=p['vendor'], product=p['product'], version=p.get('version', 0x0100), bustype=0x0003)

def apply_deadzone(value: int, deadzone: int) -> int:
    return 0 if abs(value) < deadzone else value

def flush_neutral_for_device(gp):
    try:
        for btn in BTNS: gp.emit(btn, 0, syn=False)
        for key in KBM_EVENTS:
            if str(key).startswith("KEY_") or str(key).startswith("BTN_"):
                gp.emit(key, 0, syn=False)
        gp.emit(uinput.ABS_X, 0, syn=False)
        gp.emit(uinput.ABS_Y, 0, syn=False)
        gp.emit(uinput.ABS_RX, 0, syn=False)
        gp.emit(uinput.ABS_RY, 0, syn=False)
        gp.emit(uinput.ABS_Z, 0, syn=False)
        gp.emit(uinput.ABS_RZ, 0, syn=False)
        gp.emit(uinput.ABS_HAT0X, 0, syn=False)
        gp.emit(uinput.ABS_HAT0Y, 0, syn=False)
        gp.syn()
    except Exception: pass

# ── Dynamic device manager ───────────────────────────────────────────────────
devices = {}
device_profiles = {}
viewer_modes = {}

# ── Main input loop ───────────────────────────────────────────────────────────
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        msg = json.loads(line)

        if msg.get('type') == 'set_force_xboxone':
            force_xboxone = bool(msg.get('value', True))
            continue

        if msg.get('type') == 'set-input-mode':
            vid = str(msg.get('viewerId', ''))
            mode = msg.get('mode', 'gamepad')
            viewer_modes[vid] = mode
            print(f"[input] Viewer {vid} mode set to: {mode}", flush=True)
            if mode == 'disabled':
                for k, gp in list(devices.items()):
                    if str(k).startswith(vid + '_') or str(k) == vid:
                        flush_neutral_for_device(gp)
            continue

        if msg.get('type') in ['flush_neutral', 'disconnect_viewer']:
            vid = str(msg.get('viewer_id', ''))
            keys_to_delete = [k for k in devices.keys() if str(k).startswith(vid + '_') or str(k) == vid]
            for k in keys_to_delete:
                if msg.get('type') == 'flush_neutral': flush_neutral_for_device(devices[k])
                else: del devices[k]; device_profiles.pop(k, None)
            continue

        pad_id = str(msg.get('pad_id', 'default'))
        vid = str(msg.get('viewer_id', pad_id.split('_')[0]))
        current_mode = viewer_modes.get(vid, 'gamepad')

        if current_mode == 'disabled':
            continue

        if msg.get('type') == 'gpid':
            profile = detect_profile(str(msg.get('id', '')))
            if pad_id not in device_profiles or device_profiles[pad_id] != profile:
                try:
                    devices[pad_id] = make_device(profile)
                    device_profiles[pad_id] = profile
                except Exception as e: print(f"[input] Device error: {e}", flush=True)
            continue

        # ── HANDLE GAMEPAD ──
        if msg.get('type') == 'gamepad' and current_mode == 'gamepad':
            if pad_id not in devices:
                fallback = 'xboxone' if force_xboxone else 'xbox'
                devices[pad_id] = make_device(fallback)
                device_profiles[pad_id] = fallback

            gp = devices[pad_id]
            btns = msg.get('buttons', [])
            axes = msg.get('axes', [])

            for i in range(min(len(btns), 11)):
                gp.emit(BTNS[i], 1 if btns[i]['pressed'] else 0, syn=False)

            if len(axes) >= 4:
                gp.emit(uinput.ABS_X,  apply_deadzone(axes[0], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_Y,  apply_deadzone(axes[1], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_RX, apply_deadzone(axes[2], AXIS_DEADZONE), syn=False)
                gp.emit(uinput.ABS_RY, apply_deadzone(axes[3], AXIS_DEADZONE), syn=False)

            if len(btns) >= 8:
                gp.emit(uinput.ABS_Z,  btns[6].get('value', 0), syn=False)
                gp.emit(uinput.ABS_RZ, btns[7].get('value', 0), syn=False)

            if len(btns) >= 16:
                hat_x = max(-1, min(1, (1 if btns[15]['pressed'] else 0) - (1 if btns[14]['pressed'] else 0)))
                hat_y = max(-1, min(1, (1 if btns[13]['pressed'] else 0) - (1 if btns[12]['pressed'] else 0)))
                gp.emit(uinput.ABS_HAT0X, hat_x, syn=False)
                gp.emit(uinput.ABS_HAT0Y, hat_y, syn=False)
            gp.syn()

        # ── HANDLE RAW / EMULATED KEYBOARD MOUSE ──
        if msg.get('type') == 'kbm':
            if pad_id not in devices:
                devices[pad_id] = make_device('xboxone')

            gp = devices[pad_id]

            # --- RAW KBM MODE ---
            if current_mode == 'kbm':
                event_type = msg.get('event')
                key_code = msg.get('key')

                if hasattr(uinput, str(key_code)) and getattr(uinput, str(key_code)) in KBM_EVENTS:
                    if event_type == 'keydown': gp.emit(getattr(uinput, key_code), 1)
                    if event_type == 'keyup':   gp.emit(getattr(uinput, key_code), 0)

                if event_type == 'mousemove':
                    gp.emit(uinput.REL_X, msg.get('dx', 0), syn=False)
                    gp.emit(uinput.REL_Y, msg.get('dy', 0), syn=False)
                    gp.syn()

            # --- EMULATED KBM MODE ---
            if current_mode == 'kbm_emulated':
                event_type = msg.get('event')

                if event_type == 'mousemove' and kbm_binds.get('right_stick_mouse', True):
                    mult = kbm_binds.get('right_stick_multiplier', 1500)
                    rx = max(-32767, min(32767, msg.get('dx', 0) * mult))
                    ry = max(-32767, min(32767, msg.get('dy', 0) * mult))
                    gp.emit(uinput.ABS_RX, int(rx), syn=False)
                    gp.emit(uinput.ABS_RY, int(ry), syn=False)
                    gp.syn()

                if event_type in ['keydown', 'keyup']:
                    key = msg.get('key')
                    is_down = 1 if event_type == 'keydown' else 0

                    # 1. Map to Buttons
                    if key in kbm_binds.get('buttons', {}):
                        target_btn = kbm_binds['buttons'][key]
                        if hasattr(uinput, target_btn):
                            gp.emit(getattr(uinput, target_btn), is_down)

                    # 2. Map to Left Stick
                    if key in kbm_binds.get('left_stick', {}):
                        mapping = kbm_binds['left_stick'][key]
                        target_axis = mapping['axis']
                        val = mapping['val'] if is_down else 0
                        if hasattr(uinput, target_axis):
                            gp.emit(getattr(uinput, target_axis), val)

                    # 3. Map to D-PAD
                    if key in kbm_binds.get('dpad', {}):
                        mapping = kbm_binds['dpad'][key]
                        target_axis = mapping['axis']
                        val = mapping['val'] if is_down else 0
                        if hasattr(uinput, target_axis):
                            gp.emit(getattr(uinput, target_axis), val)

    except Exception as e:
        print(f"[input] Error processing packet: {e}", flush=True)
