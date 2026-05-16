#!/usr/bin/env bash
# NearsecTogether Linux Setup & Input Fixes
echo "Checking Linux dependencies..."
if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root (or with sudo) to install system dependencies."
  exit 1
fi

# Find the exact folder this script lives in, then copy the icon
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cp "$SCRIPT_DIR/../assets/NearsecTogether.png" /usr/share/pixmaps/NearsecTogether.png 2>/dev/null

apt-get update
apt-get install -y python3-pip libudev-dev libasound2-dev libpipewire-0.3-dev
pip3 install python-uinput --break-system-packages
if ! modprobe uinput 2>/dev/null; then
  if [ -e /dev/uinput ]; then
    echo "[OK] uinput is built into this kernel (modprobe not needed)"
  else
    echo "[FAIL] uinput not available — controller input will not work"
    echo "  Try: sudo modprobe uinput  or check your kernel config"
  fi
else
  echo "[OK] uinput module loaded"
fi

echo "--- Creating udev rules for virtual controllers ---"
RULE_FILE="/etc/udev/rules.d/99-nearsec-input.rules"

cat << EOF > $RULE_FILE
# Ensure uinput itself is accessible
KERNEL=="uinput", MODE="0666", OPTIONS+="static_node=uinput"

# Xbox 360 Virtual Pad
SUBSYSTEM=="input", ATTRS{idVendor}=="045e", ATTRS{idProduct}=="028e", TAG+="uaccess"
# Xbox One Virtual Pad
SUBSYSTEM=="input", ATTRS{idVendor}=="045e", ATTRS{idProduct}=="02ea", TAG+="uaccess"
# Xbox Series Virtual Pad
SUBSYSTEM=="input", ATTRS{idVendor}=="045e", ATTRS{idProduct}=="0b12", TAG+="uaccess"
# PS4 DualShock 4 Virtual Pad
SUBSYSTEM=="input", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="09cc", TAG+="uaccess"
# PS5 DualSense Virtual Pad
SUBSYSTEM=="input", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="0ce6", TAG+="uaccess"
# Xbox One Virtual Pad (Bonus)
SUBSYSTEM=="input", ATTRS{name}=="Microsoft Xbox*", \
  ENV{ID_INPUT_JOYSTICK}="1", ENV{ID_INPUT_MOUSE}="0", ENV{ID_INPUT_KEY}="0"
EOF

udevadm control --reload-rules && udevadm trigger
echo "[OK] Linux setup complete. Virtual controllers will now bypass Steam Input interference."
