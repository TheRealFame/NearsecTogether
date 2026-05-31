"""
Windows vgamepad backend for virtual controller & KBM injection.
"""
import sys
import json
import os

try:
    import vgamepad as vg
except ImportError:
    print("[input] ERROR: vgamepad not installed. Install with: pip install vgamepad", flush=True)
    sys.exit(1)

try:
    import pyautogui
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0 # Prevent artificial delays during KBM injection
    KBM_ENABLED = True
except ImportError:
    print("[input] WARNING: pyautogui not installed. KBM passthrough disabled.", flush=True)
    KBM_ENABLED = False

PYAUTOGUI_KEY_MAP = {
    "KEY_A": "a", "KEY_B": "b", "KEY_C": "c", "KEY_D": "d", "KEY_E": "e", "KEY_F": "f",
    "KEY_W": "w", "KEY_S": "s", "KEY_Q": "q", "KEY_R": "r",
    "KEY_UP": "up", "KEY_DOWN": "down", "KEY_LEFT": "left", "KEY_RIGHT": "right",
    "KEY_SPACE": "space", "KEY_ENTER": "enter", "KEY_ESC": "esc",
    "KEY_LEFTSHIFT": "shift", "KEY_LEFTCTRL": "ctrl", "KEY_TAB": "tab",
    "KEY_Z": "z", "KEY_X": "x", "KEY_V": "v", "KEY_1": "1", "KEY_2": "2",
    "BTN_LEFT": "left", "BTN_MIDDLE": "middle", "BTN_RIGHT": "right"
}

devices = {}
viewer_modes = {}

def run():
    print("[input] Windows vgamepad + pyautogui backend initialized", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line: continue

        try:
            msg = json.loads(line)
            msg_type = msg.get("type")
            vid = str(msg.get("viewer_id", ""))

            # Update Viewer Modes
            if msg_type == "set-input-mode":
                viewer_modes[str(msg.get("viewerId", ""))] = msg.get("mode", "gamepad")
                continue

            # Cleanup Disconnected Viewers
            if msg_type in ["flush_neutral", "disconnect_viewer"]:
                keys = [k for k in list(devices.keys()) if str(k).startswith(vid + "_") or str(k) == vid]

                for k in keys:
                    gp = devices.pop(k, None)
                    if gp:
                        del gp

                import gc
                gc.collect()
                continue

            # Get current mode for this viewer (defaults to gamepad)
            current_mode = viewer_modes.get(vid, "gamepad")

            # ── KBM Handling ──
            if msg_type in ["kbm", "keyboard"]:
                if not KBM_ENABLED: continue
                # FIX: Only allow KBM if mode is strictly 'kbm' or 'hybrid'
                if current_mode not in ["kbm", "hybrid"]:
                    continue

                event_type = msg.get("event")

                if event_type == "mousemove":
                    dx, dy = msg.get("dx", 0), msg.get("dy", 0)
                    if dx != 0 or dy != 0:
                        try: pyautogui.move(dx, dy)
                        except: pass

                elif event_type in ["keydown", "keyup"]:
                    key_name = msg.get("key", "")
                    py_key = PYAUTOGUI_KEY_MAP.get(key_name, key_name.lower().replace("key_", ""))
                    try:
                        if "btn_" in key_name.lower():
                            if event_type == "keydown": pyautogui.mouseDown(button=py_key)
                            else: pyautogui.mouseUp(button=py_key)
                        else:
                            if event_type == "keydown": pyautogui.keyDown(py_key)
                            else: pyautogui.keyUp(py_key)
                    except: pass
                continue

            # ── Gamepad Handling ──
            if msg_type == "gamepad":
                # FIX: Only allow gamepad if mode is strictly 'gamepad' or 'hybrid'
                if current_mode not in ["gamepad", "hybrid"]:
                    continue

                pad_id = str(msg.get("pad_id", "default"))
                vid = pad_id.split("_")[0]

                if pad_id not in devices:
                    try:
                        devices[pad_id] = vg.VX360Gamepad()
                        devices[pad_id].update()
                    except Exception as e:
                        print(f"[input] ERROR creating virtual gamepad: {e}", flush=True)
                        continue

                gp = devices[pad_id]
                btns = msg.get("buttons", [])
                axes = msg.get("axes", [])

                try:
                    def apply_btn(idx, const):
                        if len(btns) > idx:
                            if btns[idx]["pressed"]: gp.press_button(button=const)
                            else: gp.release_button(button=const)

                    apply_btn(0, vg.XUSB_BUTTON.XUSB_GAMEPAD_A)
                    apply_btn(1, vg.XUSB_BUTTON.XUSB_GAMEPAD_B)
                    apply_btn(2, vg.XUSB_BUTTON.XUSB_GAMEPAD_X)
                    apply_btn(3, vg.XUSB_BUTTON.XUSB_GAMEPAD_Y)
                    apply_btn(4, vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER)
                    apply_btn(5, vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER)
                    apply_btn(8, vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK)
                    apply_btn(9, vg.XUSB_BUTTON.XUSB_GAMEPAD_START)
                    apply_btn(10, vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB)
                    apply_btn(11, vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB)
                    apply_btn(12, vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP)
                    apply_btn(13, vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN)
                    apply_btn(14, vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT)
                    apply_btn(15, vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT)
                    apply_btn(16, vg.XUSB_BUTTON.XUSB_GAMEPAD_GUIDE)

                    if len(axes) >= 2:
                        lx = min(1.0, max(-1.0, axes[0] / 32767.0))
                        ly = min(1.0, max(-1.0, axes[1] / 32767.0))
                        gp.left_joystick_float(x_value_float=lx, y_value_float=-ly)

                    if len(axes) >= 4:
                        rx = min(1.0, max(-1.0, axes[2] / 32767.0))
                        ry = min(1.0, max(-1.0, axes[3] / 32767.0))
                        gp.right_joystick_float(x_value_float=rx, y_value_float=-ry)

                    if len(axes) >= 6:
                        lt = min(1.0, max(0.0, axes[4] / 255.0))
                        rt = min(1.0, max(0.0, axes[5] / 255.0))
                        gp.left_trigger_float(value_float=lt)
                        gp.right_trigger_float(value_float=rt)

                    gp.update()
                except Exception as e:
                    print(f"[input] Error updating gamepad: {e}", flush=True)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f"[input] Unexpected error: {e}", flush=True)

if __name__ == "__main__":
    run()
