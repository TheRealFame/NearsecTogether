"""
NearsecTogether Input Driver Dispatcher

This is a thin dispatcher that detects the current OS at startup and loads 
the appropriate backend module for virtual controller injection.

- Linux:   Uses uinput (stable, primary target)
- Windows: EXPERIMENTAL - Uses ViGEmBus + vgamepad
- macOS:   EXPERIMENTAL - KBM only via pyautogui (no gamepad)
"""

import sys
import platform

OS = platform.system()

print(f"[input] Detected OS: {OS}", flush=True)

if OS == "Linux":
    print("[input] Loading Linux uinput backend (stable)", flush=True)
    from input_backends.linux_uinput import run
elif OS == "Windows":
    print("[input] WARNING: Windows backend is EXPERIMENTAL.", flush=True)
    print(
        "[input] Requires ViGEmBus driver: https://github.com/nefarius/ViGEmBus/releases",
        flush=True,
    )
    from input_backends.windows_vigem import run
elif OS == "Darwin":
    print("[input] WARNING: macOS backend is EXPERIMENTAL.", flush=True)
    print("[input] Gamepad injection is NOT supported on macOS.", flush=True)
    print("[input] Only keyboard/mouse passthrough is available.", flush=True)
    from input_backends.mac_stub import run
else:
    print(f"[input] ERROR: Unsupported OS: {OS}. Exiting.", flush=True)
    sys.exit(1)

# Run the backend dispatcher
if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("[input] Shutting down gracefully", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"[input] Fatal error: {e}", flush=True)
        sys.exit(1)
