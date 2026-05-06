#!/bin/bash
# Nearsec Together - VPS High-Performance Signaling Setup
# Dedicated to Ashburn VPS deployment

echo "--- Installing VPS Dependencies ---"
sudo apt update && sudo apt install -y nodejs npm ufw curl

# 1. Firewall Setup for WebRTC and Signaling
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49152:65535/udp
sudo ufw --force enable

# 2. BBR Optimization (Low Latency Tuning)
echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# 3. Install cloudflared (For persistent tunneling)
curl -L -o cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cf.deb

echo ""
echo "--- VPS PREP COMPLETE ---"
echo "Next Steps:"
echo "1. On your host machine, edit .env and paste your CF_TOKEN."
echo "2. Set CUSTOM_URL to your VPS domain (e.g., https://relay.fameproject.com)."
echo "3. Run 'node server.js' on the host and select 'Cloudflare VPS' in the UI."
echo ""
echo "Note: The VPS handles signaling, while game data remains P2P."
