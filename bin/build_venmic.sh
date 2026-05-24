#!/bin/bash
set -e
BUILDER="nearsec-builder"

# Ensure host build dir exists
mkdir -p "$PWD/build/Release"

distrobox create -n "$BUILDER" -i docker.io/library/ubuntu:24.04 -Y
distrobox enter "$BUILDER" -- sudo bash << 'EOF'
  set -e
  apt-get update && apt-get install -y build-essential cmake git nodejs npm libpipewire-0.3-dev libpulse-dev pkg-config curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs

  cd /project
  rm -rf node_modules/@vencord/venmic
  npm install Vencord/venmic
  cd node_modules/@vencord/venmic
  npm install --build-from-source

  # Robust renaming
  if [ -f "build/Release/venmic-addon.node" ]; then
    cp build/Release/venmic-addon.node /project/build/Release/venmic.node
  elif [ -f "build/Release/venmic.node" ]; then
    cp build/Release/venmic.node /project/build/Release/venmic.node
  fi
EOF

distrobox rm -f "$BUILDER"
echo "Build finalized: $PWD/build/Release/venmic.node"
