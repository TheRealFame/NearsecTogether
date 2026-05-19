"""
Linux uinput backend — stable, primary target.
Uses python-uinput to create virtual gamepad devices.

Gamepad and KBM are separate uinput devices so the OS never
mistakes stick axes for mouse movement.
"""

import sys
import json
import uinput
import time
import os


# ── 1. Gamepad Layout ────────────────────────────────────────────────────────
W3C_MAPPING = {
    0: uinput.BTN_A,
    1: uinput.BTN_B,
    2: uinput.BTN_X,
    3: uinput.BTN_Y,
    4: uinput.BTN_TL,
    5: uinput.BTN_TR,
    # 6 and 7 are Triggers (ABS_Z and ABS_RZ)
    8: uinput.BTN_SELECT,
    9: uinput.BTN_START,
    10: uinput.BTN_THUMBL,
    11: uinput.BTN_THUMBR,
    # 12-15 are D-Pad (ABS_HAT)
    16: uinput.BTN_MODE,
}
BTNS = list(W3C_MAPPING.values())
AXES = [
    uinput.ABS_X  + (-32767, 32767, 16, 128),
    uinput.ABS_Y  + (-32767, 32767, 16, 128),
    uinput.ABS_RX + (-32767, 32767, 16, 128),
    uinput.ABS_RY + (-32767, 32767, 16, 128),
    uinput.ABS_Z  + (0, 255, 0, 0),
    uinput.ABS_RZ + (0, 255, 0, 0),
    uinput.ABS_HAT0X + (-1, 1, 0, 0),
    uinput.ABS_HAT0Y + (-1, 1, 0, 0),
]

# ── 2. Raw KBM Layout ────────────────────────────────────────────────────────
KBM_EVENTS = [
    uinput.REL_X,
    uinput.REL_Y,
    uinput.REL_WHEEL,
    uinput.BTN_LEFT,
    uinput.BTN_RIGHT,
    uinput.BTN_MIDDLE,
]
# Add all possible keyboard keys to the KBM device
for name in dir(uinput):
    if name.startswith("KEY_"):
        KBM_EVENTS.append(getattr(uinput, name))

kbm_device = None
try:
    kbm_device = uinput.Device(KBM_EVENTS, name="Nearsec_KBM_Injector")
except Exception as e:
    print(f"[input] WARNING: Failed to create KBM device: {e}", flush=True)

devices = {}
device_profiles = {}
viewer_modes = {}


def make_gamepad(name):
    # Try to make the gamepad identify as an Xbox 360 controller to bypass strict Steam Input rules
    return uinput.Device(
        BTNS + AXES,
        name=name,
        vendor=0x045E,   # Microsoft
        product=0x028E,  # Xbox 360 Controller
        version=0x0110
    )


def load_emulated_kbm_profile(profile_name):
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "kbm_presets", f"{profile_name}.json")
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[input] Failed to load preset {profile_name}: {e}", flush=True)
        return None


def run():
    print("[input] Loaded kbm_bindings.json", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            msg_type = msg.get("type")

            if msg_type == "set-input-mode":
                vid = str(msg.get("viewerId", ""))
                viewer_modes[vid] = msg.get("mode", "gamepad")
                continue

            # Cleanup Disconnected Viewers
            if msg_type in ["flush_neutral", "disconnect_viewer"]:
                vid = str(msg.get("viewer_id", ""))
                keys = [k for k in list(devices.keys()) if str(k).startswith(vid + "_") or str(k) == vid]

                for k in keys:
                    gp = devices.pop(k, None)
                    if gp:
                        try:
                            gp.destroy()
                        except:
                            pass
                        del gp

                import gc
                gc.collect()
                continue

            # ── RAW KBM PASSTHROUGH ──
            if msg_type in ["kbm", "keyboard"] and kbm_device:
                event_type = msg.get("event")

                if event_type == "mousemove":
                    dx, dy = msg.get("dx", 0), msg.get("dy", 0)
                    if dx != 0: kbm_device.emit(uinput.REL_X, dx, syn=False)
                    if dy != 0: kbm_device.emit(uinput.REL_Y, dy, syn=False)
                    kbm_device.syn()

                elif event_type in ["keydown", "keyup"]:
                    key_name = msg.get("key", "")
                    is_down = 1 if event_type == "keydown" else 0

                    if hasattr(uinput, key_name):
                        kbm_device.emit(getattr(uinput, key_name), is_down)

                elif event_type in ["mousedown", "mouseup"]:
                    btn = msg.get("button", 0)
                    is_down = 1 if event_type == "mousedown" else 0
                    u_btn = uinput.BTN_LEFT if btn == 0 else uinput.BTN_MIDDLE if btn == 1 else uinput.BTN_RIGHT
                    kbm_device.emit(u_btn, is_down)
                continue


            # ── GAMEPAD MODE ──
            pad_id = str(msg.get("pad_id", "default"))
            vid = str(msg.get("viewer_id", pad_id.split("_")[0]))
            current_mode = viewer_modes.get(vid, "gamepad")

            if msg_type == "gamepad" and current_mode == "gamepad":
                if pad_id not in devices:
                    # Append _pad to keep the name short but distinct
                    safe_name = f"Nearsec_{pad_id[:10]}_pad"
                    devices[pad_id] = make_gamepad(safe_name)
                    device_profiles[pad_id] = "gamepad"
                    print(f"[input] Created xbox360 device: {safe_name}", flush=True)

                if device_profiles.get(pad_id) != "gamepad":
                    devices[pad_id] = make_gamepad(f"Nearsec_{pad_id[:10]}_pad")
                    device_profiles[pad_id] = "gamepad"

                gp = devices[pad_id]
                btns = msg.get("buttons", [])
                axes = msg.get("axes", [])

                for w3c_idx, uinput_btn in W3C_MAPPING.items():
                    if len(btns) > w3c_idx:
                        val = 1 if btns[w3c_idx]["pressed"] else 0
                        gp.emit(uinput_btn, val, syn=False)

                if len(axes) >= 2:
                    gp.emit(uinput.ABS_X, int(axes[0]), syn=False)
                    gp.emit(uinput.ABS_Y, int(axes[1]), syn=False)
                if len(axes) >= 4:
                    gp.emit(uinput.ABS_RX, int(axes[2]), syn=False)
                    gp.emit(uinput.ABS_RY, int(axes[3]), syn=False)
                if len(axes) >= 6:
                    gp.emit(uinput.ABS_Z, int(axes[4]), syn=False)
                    gp.emit(uinput.ABS_RZ, int(axes[5]), syn=False)

                if len(btns) > 15:
                    hx = -1 if btns[14]["pressed"] else 1 if btns[15]["pressed"] else 0
                    hy = -1 if btns[12]["pressed"] else 1 if btns[13]["pressed"] else 0
                    gp.emit(uinput.ABS_HAT0X, hx, syn=False)
                    gp.emit(uinput.ABS_HAT0Y, hy, syn=False)

                gp.syn()

            # ── EMULATED KBM MODE ──
            elif msg_type in ["kbm", "keyboard"] and current_mode == "kbm_emulated":
                event_type = msg.get("event")
                if event_type in ["keydown", "keyup"]:
                    kbm_binds = load_emulated_kbm_profile("fighting_classic")
                    if kbm_binds:
                        if pad_id not in devices or device_profiles.get(pad_id) != "fighting_classic":
                            fallback = f"Nearsec_{pad_id[:10]}_emu"
                            devices[pad_id] = make_gamepad(fallback)
                            device_profiles[pad_id] = fallback
                        gp = devices[pad_id]
                        key = msg.get("key")
                        is_down = 1 if event_type == "keydown" else 0

                        if key in kbm_binds.get("buttons", {}):
                            target_btn = kbm_binds["buttons"][key]
                            if hasattr(uinput, target_btn):
                                gp.emit(getattr(uinput, target_btn), is_down)

                        if key in kbm_binds.get("left_stick", {}):
                            mapping = kbm_binds["left_stick"][key]
                            target_axis = mapping["axis"]
                            val = mapping["val"] if is_down else 0
                            if hasattr(uinput, target_axis):
                                gp.emit(getattr(uinput, target_axis), val)

                        if key in kbm_binds.get("dpad", {}):
                            mapping = kbm_binds["dpad"][key]
                            target_axis = mapping["axis"]
                            val = mapping["val"] if is_down else 0
                            if hasattr(uinput, target_axis):
                                gp.emit(getattr(uinput, target_axis), val)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f"[input] Error processing message: {e}", flush=True)
