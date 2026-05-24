# API & System Setup

## 1. Manual Startup (Without the Launcher Script)
If you are developing or troubleshooting, you may want to run the components manually instead of using `./start.cmd`. Nearsec requires two separate processes to run simultaneously: the Python Input Driver, and the Node.js Web Server.

### Manual Setup on Linux (Stable)
Linux requires `sudo` privileges to inject virtual controllers directly into the kernel via `uinput`.

**Terminal 1 (The Input Driver):**
```bash
cd NearsecTogether
# Install required python packages
pip3 install -r bin/requirements-linux.txt
# Run the sidecar as root
sudo python3 src/sidecar/input_driver.py
```

**Terminal 2 (The Web Server):**
```bash
cd NearsecTogether
# Install node modules
npm install
# Launch the server and UI
npm run electron
```

### Manual Setup on Windows (Experimental)
Windows requires the third-party ViGEmBus driver to emulate controllers. 
1. Download and install the [ViGEmBus Driver](https://github.com/nefarius/ViGEmBus/releases).
2. Ensure you have Python 3.8+ and Node 18+ installed.

**Terminal 1 (The Input Driver):**
```powershell
cd NearsecTogether
pip install -r bin/requirements-windows.txt
python src/sidecar/input_driver.py
```

**Terminal 2 (The Web Server):**
```powershell
cd NearsecTogether
npm install
npm run electron
```

## 2. Environment Configuration (.env)
To prevent hardcoding sensitive tokens, Nearsec relies on a `.env` file located in your root directory. 

Create a `.env` file and populate it with your specific keys:
```ini
# Cloudflare Tunneling
CF_TOKEN=your_cloudflare_tunnel_token
CUSTOM_URL=[https://play.yourdomain.com](https://play.yourdomain.com)

# Server Port
PORT=3000

# Pusher Credentials (Required for Arcade/Matchmaking)
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_public_key
PUSHER_SECRET=your_secret_key
PUSHER_CLUSTER=us2
```

## 3. Internal Express API Endpoints
The Nearsec Node.js server exposes local HTTP POST endpoints to control the backend dynamically.

**Audio Routing (`/api/force-route`)**
* **Payload:** `{ "processName": "ALL_DESKTOP" }`
* **Action:** Forces PipeWire to dynamically link active audio streams into the `NearsecAppAudio` sink.

**Process Management (`/api/restart-game`)**
* **Payload:** `{ "command": "steam://rungameid/12345" }`
* **Action:** Kills the currently tracked game process and launches the provided command. Sending `"KILL_ONLY"` will simply terminate the current game.
