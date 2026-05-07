#!/usr/bin/env bash
# NearsecTogether Linux Setup
echo "Checking Linux dependencies..."
if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root (or with sudo) to install system dependencies."
  exit 1
fi

apt-get update
apt-get install -y python3-pip libudev-dev
pip3 install python-uinput --break-system-packages
modprobe uinput

# Add udev rule for uinput
echo 'KERNEL=="uinput", MODE="0666", OPTIONS+="static_node=uinput"' > /etc/udev/rules.d/99-nearsec-uinput.rules
udevadm control --reload-rules && udevadm trigger

echo "✓ Linux setup complete."
