"""
EXPERIMENTAL (Windows): vgamepad backend for virtual controller injection.
Requires ViGEmBus driver: https://github.com/nefarius/ViGEmBus/releases
Uses vgamepad to create XInput/DualShock 4 virtual controllers.
"""

import sys
import json
import os

try:
    import vgamepad as vg
except ImportError:
    print(
        "[input] ERROR: vgamepad not installed. Install with: pip install vgamepad",
        flush=True,
    )
    sys.exit(1)


# ── Profile settings (simplified for Windows) ──────────────────────────────────
force_xboxone = True
enable_dualshock = False
enable_motion = False

# ── Gamepad layout constants ───────────────────────────────────────────────────
AXIS_DEADZONE = 1800

# ── KBM Bindings ───────────────────────────────────────────────────────────────
try:
    import json
    if os.path.exists("kbm_bindings.json"):
        with open("kbm_bindings.json", "r") as f:
            kbm_binds = json.load(f)
            print("[input] Loaded kbm_bindings.json", flush=True)
    else:
        kbm_binds = {"right_stick_mouse": False}  # Windows doesn't support raw KBM
except Exception as e:
    print(f"[input] Error loading KBM bindings: {e}", flush=True)
    kbm_binds = {}


def detect_profile(gpid: str) -> str:
    """
    EXPERIMENTAL (Windows): simplified profile detection.
    XInput doesn't expose VID/PID, so all Xbox controllers -> XInput.
    DualShock only if explicitly enabled.
    """
    g = gpid.lower()

    # Sony detection
    is_sony = any(k in g for k in ["054c", "sony", "dualsense", "dualshock", "playstation"])
    if is_sony:
        return "dualshock4" if enable_dualshock else "xbox360"

    # Default to Xbox 360 (XInput standard)
    return "xbox360"


# ── Device manager ─────────────────────────────────────────────────────────────
devices = {}
device_profiles = {}
viewer_modes = {}
logged_gamepad_warnings = set()  # Track which pads we've already warned about


def run():
    """
    EXPERIMENTAL (Windows): Main input loop for vgamepad backend.
    Handles Xbox and DualShock 4 via ViGEmBus virtual controllers.
    
    REQUIREMENTS:
    - ViGEmBus driver: https://github.com/nefarius/ViGEmBus/releases
    - vgamepad Python package: pip install vgamepad
    
    PLATFORM NOTES:
    - KBM input forwarding is NOT supported on Windows vgamepad backend
    - Motion controls are NOT supported (XInput limitation)
    - All gamepads default to Xbox 360 profile via XInput
    """
    global force_xboxone, enable_dualshock, enable_motion

    print("[input] ========================================", flush=True)
    print("[input] Windows vgamepad backend initialized", flush=True)
    print("[input] REQUIRES: ViGEmBus driver installed", flush=True)
    print("[input] https://github.com/nefarius/ViGEmBus/releases", flush=True)
    print("[input] ========================================", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)

            # ── Configuration messages ──────────────────────────────────────
            if msg.get("type") == "set_force_xboxone":
                # Note: force_xboxone has no effect on Windows
                force_xboxone = bool(msg.get("value", True))
                print(
                    "[input] set_force_xboxone received (no effect on Windows XInput)",
                    flush=True,
                )
                continue

            if msg.get("type") == "set_enable_dualshock":
                enable_dualshock = bool(msg.get("value", False))
                print(f"[input] DualShock mode: {enable_dualshock}", flush=True)
                continue

            if msg.get("type") == "set_enable_motion":
                enable_motion = bool(msg.get("value", False))
                if enable_motion:
                    print(
                        "[input] Motion controls are NOT supported on Windows (skipped)",
                        flush=True,
                    )
                continue

            if msg.get("type") == "set-input-mode":
                vid = str(msg.get("viewerId", ""))
                mode = msg.get("mode", "gamepad")
                viewer_modes[vid] = mode
                print(f"[input] Viewer {vid} mode set to: {mode}", flush=True)
                continue

            if msg.get("type") in ["flush_neutral", "disconnect_viewer"]:
                vid = str(msg.get("viewer_id", ""))
                keys_to_delete = [k for k in devices.keys() if str(k).startswith(vid + "_") or str(k) == vid]
                for k in keys_to_delete:
                    if msg.get("type") == "disconnect_viewer":
                        try:
                            devices[k].close()
                        except Exception:
                            pass
                        del devices[k]
                        device_profiles.pop(k, None)
                continue

            pad_id = str(msg.get("pad_id", "default"))
            vid = str(msg.get("viewer_id", pad_id.split("_")[0]))
            current_mode = viewer_modes.get(vid, "gamepad")

            if current_mode == "disabled":
                continue

            # ── Gamepad ID detection ────────────────────────────────────────
            if msg.get("type") == "gpid":
                profile = detect_profile(str(msg.get("id", "")))
                if pad_id not in device_profiles or device_profiles[pad_id] != profile:
                    try:
                        if profile == "dualshock4":
                            devices[pad_id] = vg.VDS4Gamepad()
                        else:  # xbox360 or unknown
                            devices[pad_id] = vg.VX360Gamepad()
                        device_profiles[pad_id] = profile
                        print(f"[input] Created {profile} device for {pad_id}", flush=True)
                    except Exception as e:
                        print(f"[input] ERROR creating device {pad_id}: {e}", flush=True)
                continue

            # ── Gamepad input ───────────────────────────────────────────────
            if msg.get("type") == "gamepad" and current_mode == "gamepad":
                if pad_id not in devices:
                    devices[pad_id] = vg.VX360Gamepad()
                    device_profiles[pad_id] = "xbox360"

                gp = devices[pad_id]
                btns = msg.get("buttons", [])
                axes = msg.get("axes", [])

                try:
                    # Buttons (simplified mapping for vgamepad)
                    if len(btns) > 0:
                        gp.press_button(button="A" if btns[0]["pressed"] else None)
                    if len(btns) > 1:
                        gp.press_button(button="B" if btns[1]["pressed"] else None)
                    if len(btns) > 2:
                        gp.press_button(button="X" if btns[2]["pressed"] else None)
                    if len(btns) > 3:
                        gp.press_button(button="Y" if btns[3]["pressed"] else None)
                    if len(btns) > 4:
                        gp.press_button(button="LB" if btns[4]["pressed"] else None)
                    if len(btns) > 5:
                        gp.press_button(button="RB" if btns[5]["pressed"] else None)
                    if len(btns) > 6:
                        gp.press_button(button="BACK" if btns[6]["pressed"] else None)
                    if len(btns) > 7:
                        gp.press_button(button="START" if btns[7]["pressed"] else None)
                    if len(btns) > 8:
                        gp.press_button(button="LTHUMB" if btns[8]["pressed"] else None)
                    if len(btns) > 9:
                        gp.press_button(button="RTHUMB" if btns[9]["pressed"] else None)
                    if len(btns) > 10:
                        gp.press_button(button="GUIDE" if btns[10]["pressed"] else None)

                    # Axes (normalized -1.0 to 1.0 for vgamepad)
                    if len(axes) >= 2:
                        lx = min(1.0, max(-1.0, axes[0] / 32767.0))
                        ly = min(1.0, max(-1.0, axes[1] / 32767.0))
                        gp.left_trigger_float(lx)
                        gp.left_trigger_float(ly)

                    if len(axes) >= 4:
                        rx = min(1.0, max(-1.0, axes[2] / 32767.0))
                        ry = min(1.0, max(-1.0, axes[3] / 32767.0))
                        gp.right_trigger_float(rx)
                        gp.right_trigger_float(ry)

                    # Triggers (axes[4], axes[5])
                    if len(axes) >= 6:
                        lt = min(1.0, max(0.0, axes[4] / 255.0))
                        rt = min(1.0, max(0.0, axes[5] / 255.0))
                        gp.left_trigger(lt)
                        gp.right_trigger(rt)

                    # D-Pad (axes[6], axes[7])
                    if len(btns) >= 16:
                        dpad_x = -1 if btns[14]["pressed"] else (1 if btns[15]["pressed"] else 0)
                        dpad_y = -1 if btns[12]["pressed"] else (1 if btns[13]["pressed"] else 0)
                        if dpad_x != 0 or dpad_y != 0:
                            # vgamepad dpad handling varies; we use button presses
                            pass

                    gp.update()
                except Exception as e:
                    print(f"[input] Error updating gamepad {pad_id}: {e}", flush=True)
                continue

            # ── Motion control (not supported on Windows) ────────────────────
            if msg.get("type") == "motion":
                if pad_id not in logged_gamepad_warnings:
                    print(
                        f"[input] WARNING: Motion not supported on Windows, ignoring for {pad_id}",
                        flush=True,
                    )
                    logged_gamepad_warnings.add(pad_id)
                continue

            # ── KBM modes (limited on Windows) ──────────────────────────────
            if msg.get("type") == "kbm":
                # Windows doesn't support raw KBM injection via vgamepad
                # Log a note and skip
                print("[input] KBM passthrough not supported on Windows vgamepad backend", flush=True)
                continue

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f"[input] Unexpected error: {e}", flush=True)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("[input] Windows vgamepad backend shutting down", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"[input] Fatal error: {e}", flush=True)
        sys.exit(1)
