const express = require("express");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const os = require("os");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const open = (...args) => import('open').then(({default: open}) => open(...args));
const which = require("which");
const killPort = require("kill-port");
let hostWS = null;
let tunnelUrl = null;
let activeTunnelProc = null;
let vidCount = 0;
const viewers = new Map();
const viewerNames = new Map();
const inputPerms = new Map();
const pinAttempts = new Map();
const crypto = require("crypto");

const PusherRaw = require('pusher-js');

// ── Bulletproof Electron/Node Module Extractor ──
let Pusher;
if (typeof PusherRaw === 'function') {
  Pusher = PusherRaw;
} else if (PusherRaw && typeof PusherRaw.Pusher === 'function') {
  Pusher = PusherRaw.Pusher;
} else if (PusherRaw && typeof PusherRaw.default === 'function') {
  Pusher = PusherRaw.default;
} else {
  console.error("PUSHER DIAGNOSTIC:", PusherRaw);
  // Fake the class so the Node server doesn't crash while we look at the logs
  Pusher = class DummyPusher {
    subscribe() { return { trigger: () => {} }; }
  };
}

const pusher = new Pusher('a93f5405058cd9fc7967', {
  cluster: 'us2',
  authEndpoint: 'https://nearsec.cutefame.net/api/pusher-auth'
});

const globalArcadeChannel = pusher.subscribe('private-arcade-global');

const projectRoot = path.join(__dirname, '..', '..');
const envFile = path.join(projectRoot, '.env');
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, `CF_TOKEN=
CUSTOM_URL=
ZROK_RESERVED_NAME=
USE_VPS=false
VPS_HOST=
IS_VPS=false
`);
}

// Parse optional .env file for secrets
try {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) process.env[match[1]] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
  });
} catch (e) { }

function getLanIP() {
  for (const iface of Object.values(os.networkInterfaces()))
    for (const n of iface)
      if (n.family === "IPv4" && !n.internal) return n.address;
      return "127.0.0.1";
}
function shouldRequirePin(ip, hasTunnelHeader = false) {
  return true; // Security: everyone requires PIN
  if (!ip) return true;
  // 1. If it's a 192.168.x.x address, it's someone physically in the house.
  if (ip.startsWith('192.168.') || ip.startsWith('::ffff:192.168.')) {
    return false; // Safe to bypass
  }
  // 2. Localhost check
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    // If we have a tunnel header OR USING_TUNNEL is explicitly true, treat as remote
    if (hasTunnelHeader || process.env.USING_TUNNEL === 'true') {
      return true; // Require PIN
    }
    return false; // Safe if just testing locally
  }
  // 3. Tailscale range (100.x.x.x) - treat as semi-trusted if needed, but safer to require PIN
  if (ip.startsWith('100.')) return false;

  return true; // Everyone else requires a PIN
}
function getTailscaleIP() {
  // Tailscale assigns 100.64.0.0/10 addresses (CGNAT range)
  for (const iface of Object.values(os.networkInterfaces()))
    for (const n of iface)
      if (n.family === "IPv4" && n.address.startsWith("100.")) return n.address;
      return null;
}
function findFreePort(start) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(start, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", () => findFreePort(start + 1).then(resolve));
  });
}
function openBrowser(url) {
  open(url).catch(() => { });  // Cross-platform: works on Linux, Windows, macOS
}
function getPublicIP() {
  return new Promise(resolve => {
    https.get("https://api.ipify.org", res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d.trim()));
    }).on("error", () => resolve(null));
  });
}
// ── Tunnel providers ─────────────────────────────────────────────────────────
// Set TUNNEL=cloudflared|playit|localhostrun env var to force a provider.
// Default: tries cloudflared → playit → localhost.run automatically.

function startTunnelCloudflared(port) {
  return new Promise(resolve => {
    which("cloudflared").then(cloudflaredPath => {
      // If the user provided a token in .env (Remotely Managed)
      if (process.env.CF_TOKEN) {
        console.log("  \x1b[33m~\x1b[0m Starting persistent Cloudflare tunnel (Token)...");
        const proc = spawn("cloudflared", ["tunnel", "--no-autoupdate", "run", "--token", process.env.CF_TOKEN], { stdio: ["ignore", "pipe", "pipe"] });
        const url = process.env.CUSTOM_URL || "https://your-custom-domain.com";
        console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + url + "\x1b[0m");
        activeTunnelProc = proc;
        return resolve({ url, proc });
      }

      // If the user provided a tunnel name in .env (Locally Managed - "The old way")
      if (process.env.CF_TUNNEL_NAME) {
        console.log("  \x1b[33m~\x1b[0m Starting persistent Cloudflare tunnel (Locally Managed)...");
        const proc = spawn("cloudflared", ["tunnel", "run", process.env.CF_TUNNEL_NAME], { stdio: ["ignore", "pipe", "pipe"] });
        const url = process.env.CUSTOM_URL || "https://your-custom-domain.com";
        console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + url + "\x1b[0m");
        activeTunnelProc = proc;
        return resolve({ url, proc });
      }

      console.log("  \x1b[33m~\x1b[0m Starting cloudflared tunnel...");
      const proc = spawn("cloudflared", ["tunnel", "--url", "http://localhost:" + port], { stdio: ["ignore", "pipe", "pipe"] });
      let done = false;
      const check = data => {
        const m = data.toString().match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
        if (m && !done) { done = true; resolve({ url: m[0], proc }); console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + m[0] + "\x1b[0m"); }
      };
      proc.stdout.on("data", check); proc.stderr.on("data", check);
      proc.on("close", () => { if (!done) resolve(null); });
      setTimeout(() => { if (!done) { done = true; resolve(null); console.log("  \x1b[33m!\x1b[0m cloudflared timeout"); } }, 20000);
    }).catch(err => {
      resolve(null);
    });
  });
}

function startTunnelPlayit(port) {
  return new Promise(resolve => {
    which("playit").then(playitPath => {
      console.log("  \x1b[33m~\x1b[0m Starting playit tunnel...");
      const proc = spawn("playit", [], { stdio: ["ignore", "pipe", "pipe"] });
      let done = false;
      const check = data => {
        const str = data.toString();
        // First run: print claim URL and open browser
        const claim = str.match(/https:\/\/playit\.gg\/claim\/[a-z0-9\-]+/i);
        if (claim) { console.log("  \x1b[33m!\x1b[0m playit first-run — visit: \x1b[1m" + claim[0] + "\x1b[0m"); openBrowser(claim[0]); }
        // Assigned tunnel URL
        const url = str.match(/https?:\/\/[a-z0-9\-]+\.at\.playit\.gg(?::\d+)?/i)
        || str.match(/https?:\/\/[a-z0-9\-]+\.playit\.gg(?::\d+)?/i);
        if (url && !done) { done = true; resolve({ url: url[0], proc }); console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + url[0] + "\x1b[0m"); }
      };
      proc.stdout.on("data", check); proc.stderr.on("data", check);
      proc.on("close", () => { if (!done) resolve(null); });
      setTimeout(() => { if (!done) { done = true; resolve(null); console.log("  \x1b[33m!\x1b[0m playit timeout"); } }, 45000);
    }).catch(err => {
      resolve(null);
    });
  });
}

function startTunnelLocalhostRun(port) {
  return new Promise(resolve => {
    which("ssh").then(sshPath => {
      console.log("  \x1b[33m~\x1b[0m Starting localhost.run tunnel (SSH)...");
      const proc = spawn("ssh", [
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",  // never prompt for host key
        "-o", "LogLevel=ERROR",               // suppress SSH banners
        "-o", "ServerAliveInterval=30",
        "-R", "80:localhost:" + port,
        "nokey@localhost.run"
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let done = false;
      const check = data => {
        const str = data.toString();
        // localhost.run changed URL format a few times — catch all variants
        const m = str.match(/https:\/\/[a-z0-9\-]+\.(?:lhr\.life|localhost\.run)/);
        if (m && !done) { done = true; resolve({ url: m[0], proc }); console.log("  \x1b[32m\u2713\x1b[0m Tunnel URL: \x1b[1m" + m[0] + "\x1b[0m"); }
      };
      proc.stdout.on("data", check); proc.stderr.on("data", check);
      proc.on("close", c => { if (!done) { resolve(null); console.log("  \x1b[33m!\x1b[0m localhost.run closed (code " + c + ")"); } });
      setTimeout(() => { if (!done) { done = true; proc.kill(); resolve(null); console.log("  \x1b[33m!\x1b[0m localhost.run timeout — port 22 may be blocked"); } }, 25000);
    }).catch(err => {
      resolve(null);
    });
  });
}

function startTunnelServeo(port) {
  // serveo.net — SSH-based like localhost.run, different server, often works when lr is blocked
  return new Promise(resolve => {
    which("ssh").then(sshPath => {
      console.log("  \x1b[33m~\x1b[0m Starting serveo.net tunnel (SSH)...");
      const proc = spawn("ssh", [
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-o", "ServerAliveInterval=30",
        "-R", "80:localhost:" + port,
        "serveo.net"
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let done = false;
      const check = data => {
        const m = data.toString().match(/https:\/\/[a-z0-9\-]+\.serveo\.net/);
        if (m && !done) { done = true; resolve({ url: m[0], proc }); console.log("  \x1b[32m\u2713\x1b[0m Tunnel URL: \x1b[1m" + m[0] + "\x1b[0m"); }
      };
      proc.stdout.on("data", check); proc.stderr.on("data", check);
      proc.on("close", c => { if (!done) { resolve(null); console.log("  \x1b[33m!\x1b[0m serveo closed (code " + c + ")"); } });
      setTimeout(() => { if (!done) { done = true; proc.kill(); resolve(null); console.log("  \x1b[33m!\x1b[0m serveo timeout — port 22 may be blocked"); } }, 25000);
    }).catch(err => {
      resolve(null);
    });
  });
}


function startTunnelVps(port, vpsHost) {
  return new Promise((resolve) => {
    console.log(`  \x1b[33m~\x1b[0m Starting VPS Reverse SSH Tunnel to ${vpsHost}...`);
    const proc = spawn("ssh", [
      "-v", "-N", "-T",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-R", `0.0.0.0:${port}:localhost:${port}`, vpsHost
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const url = process.env.CUSTOM_URL || `http://${vpsHost.split('@').pop().trim()}:${port}`;
    let done = false;

    proc.stderr.on("data", data => {
      const out = data.toString();
      // Print to terminal console as requested
      process.stderr.write(out);
      // Logs removed from GUI as requested

      // Check for success markers in verbose output
      if ((out.includes("remote forward success") || out.includes("Forwarding address")) && !done) {
        done = true;
        process.env.USING_TUNNEL = "true";
        activeTunnelProc = proc; resolve({ url, proc });
      }
    });
    proc.on("close", () => { if (!done) resolve(null); });
    setTimeout(() => {
      if (!done) {
        done = true;
        process.env.USING_TUNNEL = "true";
        activeTunnelProc = proc; resolve({ url, proc });
      }
    }, 5000);
  });
}

function startTunnelZrok(port) {
  return new Promise(async (resolve) => {
    const findZrok = () => {
      const paths = ['zrok2', 'zrok', '/usr/bin/zrok2', '/usr/bin/zrok', '/usr/local/bin/zrok', path.join(process.env.HOME || '', 'bin/zrok'), './zrok'];
      for (const p of paths) if (fs.existsSync(p)) return p;
      return 'zrok2';
    };
    const bin = findZrok();
    console.log(`  \x1b[33m~\x1b[0m Starting ${bin} public share...`);
    const args = ["share", "public", "http://localhost:" + port, "--backend-mode", "proxy", "--headless"];
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let done = false;
    const check = data => {
      const out = data.toString();
      const m = out.match(/(https:\/\/)?([a-z0-9\-]+\.shares?\.zrok\.io)/i);
      if (m && !done) {
        done = true;
        const url = m[1] ? m[0] : "https://" + m[2];
        process.env.USING_TUNNEL = "true";
        activeTunnelProc = proc; resolve({ url, proc });
        console.log("  \x1b[32m\u2713\x1b[0m Tunnel URL: \x1b[1m" + url + "\x1b[0m");
      }
    };
    proc.stdout.on("data", check); proc.stderr.on("data", check);
    proc.on("close", () => { if (!done) resolve(null); });
    setTimeout(() => { if (!done) { done = true; proc.kill(); resolve(null); } }, 20000);
  });
}


async function startTunnel(port) {
  const forced = (process.env.TUNNEL || "").toLowerCase();
  if (forced === "zrok") return startTunnelZrok(port);
  if (forced === "vps") return startTunnelVps(port, process.env.VPS_HOST);
  if (forced === "cloudflared") return startTunnelCloudflared(port);
  if (forced === "playit") return startTunnelPlayit(port);
  if (forced === "localhostrun") return startTunnelLocalhostRun(port);
  if (forced === "serveo") return startTunnelServeo(port);
  // Auto: try cloudflared -> zrok -> playit
  const cf = await startTunnelCloudflared(port);
  if (cf) return cf;
  const z = await startTunnelZrok(port);
  if (z) return z;
  const pl = await startTunnelPlayit(port);
  if (pl) return pl;
  // Try both SSH providers in parallel — whichever answers first wins
  console.log("  \x1b[33m~\x1b[0m Trying localhost.run and serveo in parallel...");
  const ssh = await Promise.any([
    startTunnelLocalhostRun(port),
                                startTunnelServeo(port)
  ].map(p => p.then(r => r || Promise.reject()))).catch(() => null);
  if (ssh) return ssh;
  console.log("  \x1b[33m!\x1b[0m All tunnels failed. Options:");
  console.log("    cloudflared  : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  console.log("    serveo/lhr   : outbound SSH (port 22) may be blocked by your router/ISP");
  console.log("    TUNNEL=cloudflared  node server.js   # force a specific provider");
  return null;
}

function sanitize(str) {
  return String(str).replace(/[<>&"']/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])).slice(0, 300);
}
function makePin() { return String(Math.floor(1000 + Math.random() * 9000)); }

// ── Arcade session registry ───────────────────────────────────────────────────
const arcadeSessions = new Map(); // hostWS-id → session object
const arcadeClients  = new Set(); // /ws/arcade subscriber connections
let   arcadeHostId   = 0;         // simple counter for host identity key

// Only sessions originating from known tunnel providers are listed.
// This prevents malicious redirects to attacker-controlled domains.
const ARCADE_ALLOWED_DOMAINS = [
  'trycloudflare.com',
'zrok.io',
'localhost.run',
'serveo.net',
];
function isAllowedArcadeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // Must be HTTPS
    if (u.protocol !== 'https:') return false;
    return ARCADE_ALLOWED_DOMAINS.some(d =>
    u.hostname === d || u.hostname.endsWith('.' + d)
    );
  } catch { return false; }
}
function broadcastToArcade(msg) {
  const data = JSON.stringify(msg);
  arcadeClients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

// ── Persistent config (tunnel preference) ────────────────────────────────────
const CONFIG_FILE = path.join(projectRoot, 'config', 'nearsectogether.config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function saveConfig(updates) {
  const cfg = { ...loadConfig(), ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

async function main() {
  // ── Platform Detection & Warnings ──────────────────────────────────────────
  if (process.platform === 'win32' || process.platform === 'darwin') {
    console.warn('');
    console.warn('⚠  WARNING: Running on an EXPERIMENTAL platform.');
    console.warn('   Windows and macOS support is untested and incomplete.');
    console.warn('   Linux is the only fully supported host OS.');
    console.warn('');
  }

  const PORT = await findFreePort(3000);
  const LAN_IP = getLanIP();
  const PUBLIC_IP = await getPublicIP();
  let PIN = makePin();
  let pinEnabled = true;
  // tunnelUrl moved to top

  console.log("\n  \x1b[1mNearsecTogether\x1b[0m");
  console.log("  Host page : http://localhost:" + PORT + "/host");
  console.log("  LAN URL   : http://" + LAN_IP + ":" + PORT + "/");
  if (PUBLIC_IP) console.log("  Public IP : http://" + PUBLIC_IP + ":" + PORT + "/ (needs port forward)");
    console.log("  PIN       : \x1b[1;32m" + PIN + "\x1b[0m\n");

  const app = express();

  // Auto-start VPS tunnel if configured in .env
  if (process.env.USE_VPS === 'true' && process.env.VPS_HOST) {
    startTunnelVps(PORT, process.env.VPS_HOST.trim()).then(tun => {
      if (tun) tunnelUrl = tun.url;
    });
  } else {
    // Check config for saved tunnel preference
    const cfg = loadConfig();
    if (cfg.neverAsk && cfg.tunnelProvider && cfg.tunnelProvider !== 'portforward') {
      const vpsHost = cfg.vpsHost || process.env.VPS_HOST;
      const fn = {
        zrok: startTunnelZrok,
        cloudflared: startTunnelCloudflared,
        playit: startTunnelPlayit,
        localhostrun: startTunnelLocalhostRun,
        vps: (p) => startTunnelVps(p, vpsHost)
      }[cfg.tunnelProvider];
      if (fn) fn(PORT).then(tun => { if (tun) tunnelUrl = tun.url; });
    }
  }

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Security headers — required for Gamepad API + display-capture over HTTPS/Cloudflare
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "gamepad=*, display-capture=(self)");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  const APP_VERSION = "1.0.0";

  // Static folders at the project root
  app.use("/js", express.static(path.join(__dirname, "..", "..", "src", "scripts")));
  app.use("/assets", express.static(path.join(__dirname, "..", "..", "assets")));

  // Pages folder at the project root
  const pagesDir = path.join(__dirname, "..", "..", "src/pages");

  app.get("/", (req, res) => res.sendFile(path.join(pagesDir, "index.html")));
  app.get("/host", (req, res) => res.sendFile(path.join(pagesDir, "host.html")));
  app.get("/gamepad-popup.html", (req, res) => res.sendFile(path.join(pagesDir, "gamepad-popup.html")));

  // API Routes (Logic remains the same)
  app.get("/api/info", (req, res) => res.json({ lanIP: LAN_IP, port: PORT, pin: PIN, publicIP: PUBLIC_IP || null, tunnelUrl: tunnelUrl || null, version: APP_VERSION }));
  app.get("/api/pin-required", (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const hasTunnelHeader = !!req.headers['x-forwarded-for'] || !!req.headers['cf-connecting-ip'];
    res.json({ required: pinEnabled && shouldRequirePin(clientIp, hasTunnelHeader) });
  });
  app.get("/api/config", (req, res) => res.json(loadConfig()));
  app.post("/api/config", express.json(), (req, res) => { res.json(saveConfig(req.body || {})); });

  app.get("/api/status", (req, res) => {
    res.json({
      online: !!hostWS,
      streaming: hostStreaming,
      viewers: viewers.size,
      controllers: controllerViewerCount(),
             tunnel: tunnelUrl,
             version: APP_VERSION,
             uptime: process.uptime()
    });
  });

  // ── Arcade sessions REST (polled by arcade.js as fallback) ───────────────────
  app.get("/api/arcade/sessions", (req, res) => {
    res.json([...arcadeSessions.values()]);
  });

  // Trigger a tunnel start from the host UI picker
  app.post("/api/start-tunnel", express.json(), async (req, res) => {
    if (tunnelUrl) {
      const msg = JSON.stringify({ type: "tunnel-url", url: tunnelUrl });
      if (hostWS && hostWS.readyState === 1) hostWS.send(msg);
      return res.json({ url: tunnelUrl }); // already running
    }
    const provider = (req.body && req.body.provider) || "cloudflared";
    if (req.body && req.body.remember) saveConfig({ tunnelProvider: provider, neverAsk: true });
    if (req.body && req.body.remember === false) saveConfig({ neverAsk: false }); // clear preference
    res.json({ ok: true, starting: true });
    // Start asynchronously so the response returns immediately
    const fn = {
      zrok: startTunnelZrok,
      cloudflared: startTunnelCloudflared,
      playit: startTunnelPlayit,
      localhostrun: startTunnelLocalhostRun,
      vps: (p) => startTunnelVps(p, ((req.body && req.body.vpsHost) || process.env.VPS_HOST || '').trim()),
           portforward: async () => null
    }[provider] || startTunnel;

    if (provider === 'vps' && req.body && req.body.vpsHost) {
      saveConfig({ vpsHost: req.body.vpsHost });
    }

    const tun = await fn(PORT);
    if (tun) {
      tunnelUrl = tun.url;
      const msg = JSON.stringify({ type: "tunnel-url", url: tunnelUrl });
      if (hostWS && hostWS.readyState === 1) hostWS.send(msg);
      viewers.forEach(vws => { if (vws.readyState === 1) vws.send(msg); });
    } else {
      if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "tunnel-error", provider }));
    }
  });

  // ── uinput sidecar ─────────────────────────────────────────────────────────
  let uinputProc = null;
  const sidecar = path.join(__dirname, "..", "sidecar", "input_driver.py");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  if (fs.existsSync(sidecar)) {
    try {
      uinputProc = spawn(pythonCmd, [sidecar], { stdio: ["pipe", "inherit", "inherit"], detached: false });
      uinputProc.stdin.on("error", () => { });
      uinputProc.on("error", e => console.log("[uinput] spawn error:", e.message));
      uinputProc.on("close", () => { uinputProc = null; console.log("[uinput] sidecar exited"); });
      console.log("[uinput] sidecar started");
    } catch (err) {
      console.warn("[uinput] Failed to start Python sidecar:", err.message);
      console.warn("[uinput] Input handling will not be available");
      uinputProc = null;
    }
  } else {
    console.log("[uinput] sidecar not found at", sidecar);
  }

  function toUinput(msg) {
    if (!uinputProc || !uinputProc.stdin.writable) return;
    setImmediate(() => { try { uinputProc.stdin.write(JSON.stringify(msg) + "\n"); } catch { } });
  }

  // hostWS moved to top
  let hostStreaming = false;
  // viewers moved to top
  const audioViewers = new Set();
  // inputPerms moved to top
  // viewerNames moved to top
  const viewerGamepads = new Map(); // viewerId -> Set of padIndices
  const viewerHasController = new Set(); // viewerIds that have sent at least one gpid
  // pinAttempts moved to top // ip -> { count, lockedUntil }
  // vidCount moved to top

  // ── Join & Leave Sounds ────────────────────────────────────────────────────
  const JOIN_SOUND = __dirname + '/assets/joinsound.wav';
  const LEAVE_SOUND = __dirname + '/assets/leavesound.wav';
  const player = require('play-sound')(opts = {});

  function playSound(file) {
    if (!fs.existsSync(file)) return;
    // EXPERIMENTAL (Windows) and (macOS) use play-sound; stable on Linux
    player.play(file, (err) => {
      if (err && process.platform === 'linux') console.log("[audio] Could not play sound:", err.message);
    });
  }
  function playJoinSound() { playSound(JOIN_SOUND); }
  function playLeaveSound() { playSound(LEAVE_SOUND); }

  function broadcast(data) {
    viewers.forEach(vws => { if (vws.readyState === 1) vws.send(data); });
  }

  function controllerViewerCount() {
    return viewerHasController.size;
  }

  function broadcastRoster() {
    const roster = [];
    // Iterate over ALL viewers so no one disappears if they use KBM or get Disabled
    viewers.forEach((vws, id) => {
      const pads = viewerGamepads.get(id) || new Set([0]); // Everyone gets at least slot 0
      pads.forEach(padIdx => {
        const isExtra = padIdx > 0;
        const nameSuffix = isExtra ? ' ' + (padIdx + 1) : '';
        const rosterId = id + '_' + padIdx;
        const p = inputPerms.get(rosterId) || { gp: true, kb: false, slot: null };

        // Determine actual input mode so host UI stays synced
        let mode = 'gamepad';
        if (!p.gp && p.kb) mode = 'kbm';
        else if (p.gp && p.kb) mode = 'kbm_emulated';
        else if (!p.gp && !p.kb) mode = 'disabled';

        roster.push({
          id: rosterId,
          name: (viewerNames.get(id) || id) + nameSuffix,
                    gp: !!p.gp,
                    kb: !!p.kb,
                    slot: p.slot ?? null,
                    locked: !!p.locked,
                    inputMode: mode
        });
      });
    });
    const count = controllerViewerCount();
    const msg = JSON.stringify({ type: "roster", viewers: roster, controllerCount: count });
    broadcast(msg);
    if (hostWS && hostWS.readyState === 1) hostWS.send(msg);
  }

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    const pin = url.searchParams.get("pin") || "";

    // ── HOST ─────────────────────────────────────────────────────────────────
    if (path === "/ws/host") {
      console.log("[host] connected");
      hostWS = ws;
      // Broadcast to all viewers that a host is now online
      broadcast(JSON.stringify({ type: "host-connected" }));
      // Replay existing viewers so host can re-offer on reconnect
      viewers.forEach((_, id) => ws.send(JSON.stringify({ type: "viewer-joined", viewerId: id, name: viewerNames.get(id) || id })));
      if (tunnelUrl) ws.send(JSON.stringify({ type: "tunnel-url", url: tunnelUrl }));

      ws.on("message", raw => {
        try {
          const msg = JSON.parse(raw);

          // ── WebRTC signaling relay: offer / ice-host → specific viewer ──
          if ((msg.type === "offer" || msg.type === "ice-host") && msg._viewerId) {
            const vws = viewers.get(msg._viewerId);
            if (vws && vws.readyState === 1) vws.send(JSON.stringify(msg));
            return;
          }

          if (msg.type === "set-pin") { pinEnabled = !!msg.enabled; return; }
          if (msg.type === "set-input") {
            const cur = inputPerms.get(msg.viewerId) || { gp: true, kb: false, slot: null };
            inputPerms.set(msg.viewerId, { gp: !!msg.gp, kb: !!msg.kb, slot: cur.slot });

            // If host disabled them, and they are pad 0, notify the client.
            const realId = msg.viewerId.split('_')[0];
            const vws = viewers.get(realId);
            if (vws && vws.readyState === 1 && msg.viewerId.endsWith('_0')) {
              vws.send(JSON.stringify({ type: "input-state", gp: !!msg.gp, kb: !!msg.kb }));
            }
            broadcastRoster();
            return;
          }
          if (msg.type === "assign-slot") {
            const cur = inputPerms.get(msg.viewerId) || { gp: true, kb: false, slot: null };
            inputPerms.set(msg.viewerId, { ...cur, slot: msg.slot });

            const realId = msg.viewerId.split('_')[0];
            const vws = viewers.get(realId);
            if (vws && vws.readyState === 1 && msg.viewerId.endsWith('_0')) {
              vws.send(JSON.stringify({ type: "slot-assigned", slot: msg.slot }));
            }
            broadcastRoster();
            return;
          }
          if (msg.type === "chat") { broadcast(JSON.stringify(msg)); return; }

          // ── Controller settings — forwarded to Python sidecar, NOT broadcast ──
          if (msg.type === "ctrl-settings") {
            toUinput({ type: 'set_force_xboxone',    value: !!msg.forceXboxOne });
            toUinput({ type: 'set_enable_dualshock', value: !!msg.enableDualShock });
            toUinput({ type: 'set_enable_motion',    value: !!msg.enableMotion });
            console.log("[host] ctrl-settings: forceXboxOne=%s enableDualShock=%s enableMotion=%s",
                        !!msg.forceXboxOne, !!msg.enableDualShock, !!msg.enableMotion);
            return;
          }

          // ── Input mode change for a specific viewer slot ──────────────────────
          if (msg.type === "set-input-mode") {
            const modeMap = { gamepad: { gp: true, kb: false }, kbm: { gp: false, kb: true }, kbm_emulated: { gp: true, kb: true }, disabled: { gp: false, kb: false } };
            const perms = modeMap[msg.mode] || { gp: true, kb: false };
            const cur = inputPerms.get(msg.viewerId) || { gp: true, kb: false, slot: null };
            inputPerms.set(msg.viewerId, { ...cur, ...perms });
            const realId = msg.viewerId.split('_')[0];
            const vws = viewers.get(realId);
            if (vws && vws.readyState === 1) vws.send(JSON.stringify({ type: "input-state", gp: perms.gp, kb: perms.kb, mode: msg.mode }));
            broadcastRoster();
            return;
          }

          // ── Toggle slot lock ──────────────────────────────────────────────────
          if (msg.type === "toggle-slot-lock") {
            const cur = inputPerms.get(msg.viewerId) || { gp: true, kb: false, slot: null };
            inputPerms.set(msg.viewerId, { ...cur, locked: !!msg.locked });
            broadcastRoster();
            return;
          }

          // ── Regenerate PIN ────────────────────────────────────────────────────
          if (msg.type === "regen-pin") {
            PIN = makePin();
            console.log("[host] PIN regenerated:", PIN);
            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "regen-pin", pin: PIN }));
            return;
          }

          // ── Arcade session management ─────────────────────────────────────────
          if (msg.type === "arcade-session-start") {
            const url = msg.tunnelUrl || tunnelUrl;

            if (!url) {
              if (hostWS && hostWS.readyState === 1)
                hostWS.send(JSON.stringify({ type: 'arcade-session-error', reason: 'No tunnel URL active. Start a tunnel first.' }));
              return;
            }
            if (!isAllowedArcadeUrl(url)) {
              console.warn("[arcade] Rejected URL — not in whitelist:", url);
              if (hostWS && hostWS.readyState === 1)
                hostWS.send(JSON.stringify({ type: 'arcade-session-error', reason: 'Tunnel provider not allowed. Use cloudflared, zrok, localhost.run, or serveo.' }));
              return;
            }
            if (!hostStreaming) {
              if (hostWS && hostWS.readyState === 1)
                hostWS.send(JSON.stringify({ type: 'arcade-session-error', reason: 'No active stream. Start sharing your screen first.' }));
              return;
            }

            const sessionId = 'ns-' + Date.now() + '-' + (++arcadeHostId);
            const session = {
              id: sessionId,
              game: sanitize(msg.config?.title || 'Arcade Game'),
            thumbnail: msg.config?.thumbnail || null,
            region: 'Nearsec Arcade',
            hasPin: !!msg.config?.requirePin,
            maxPlayers: parseInt(msg.config?.maxPlayers || 4),
            url: url,
            startedAt: Date.now(),
            isStreaming: true,
            };

            arcadeSessions.set(sessionId, session);
            console.log("[arcade] Session registered:", session.game, url);
            broadcastToArcade({ type: 'arcade-session-active', session });
            if (hostWS && hostWS.readyState === 1)
              hostWS.send(JSON.stringify({ type: 'arcade-session-active', session }));

            // Broadcast this session to the Global Cloudflare Arcade!
            globalArcadeChannel.trigger('client-session-active', { session });
            return;
          }

          if (msg.type === "arcade-session-stop") {
            for (const [id, s] of arcadeSessions) {
              arcadeSessions.delete(id);
              broadcastToArcade({ type: 'arcade-session-stopped', id });
              console.log("[arcade] Session stopped:", s.game);

              // Tell the Global Arcade to remove this session
              globalArcadeChannel.trigger('client-session-stopped', { id });
            }
            return;
          }

          if (msg.type === "host-stream-ready") hostStreaming = true;
          if (msg.type === "host-stream-stopped") {
            hostStreaming = false;
            for (const [id, s] of arcadeSessions) {
              arcadeSessions.delete(id);
              broadcastToArcade({ type: 'arcade-session-stopped', id });
            }
          }

          // Fallback broadcast (host-stream-stopped, host-stream-ready, etc.)
          broadcast(JSON.stringify(msg));

        } catch (err) {
          console.error("[host] Message parsing error:", err.message);
        }
      });

      ws.on("close", () => {
        console.log("[host] disconnected");
        hostWS = null;
        hostStreaming = false;
        // Delist any arcade sessions owned by this host
        for (const [id] of arcadeSessions) {
          arcadeSessions.delete(id);
          broadcastToArcade({ type: 'arcade-session-stopped', id });
        }
        broadcast(JSON.stringify({ type: "host-disconnected" }));
      });

      // ── VIEWER ───────────────────────────────────────────────────────────────
    } else if (path === "/ws/viewer") {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const hasTunnelHeader = !!req.headers['x-forwarded-for'] || !!req.headers['cf-connecting-ip'];
      const requirePin = shouldRequirePin(clientIp, hasTunnelHeader);

      if (pinEnabled && requirePin) {
        const attempt = pinAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };
        if (Date.now() < attempt.lockedUntil) {
          try { ws.send(JSON.stringify({ type: "pin-rejected", reason: "rate-limited" })); } catch { }
          ws.close();
          console.log(`[viewer] rejected — IP ${clientIp} is rate-limited`);
          return;
        }
        if (pin !== PIN) {
          attempt.count++;
          if (attempt.count >= 6) {
            attempt.lockedUntil = Date.now() + 2 * 60 * 1000; // 2 mins
            console.log(`[viewer] IP ${clientIp} locked out for 2 minutes (PIN brute-force)`);
          }
          pinAttempts.set(clientIp, attempt);
          try { ws.send(JSON.stringify({ type: "pin-rejected" })); } catch { }
          ws.close();
          console.log("[viewer] rejected — wrong PIN");
          return;
        }
        pinAttempts.delete(clientIp);
      } else {
        // Log that a local user bypassed the check
        console.log(`[viewer] IP ${clientIp} (requirePin=${requirePin}) bypassing PIN/rate-limit check`);
      }
      let id = "v" + (++vidCount);
      const defaultName = "Guest" + (1000 + Math.floor(Math.random() * 9000));
      viewers.set(id, ws);
      viewerNames.set(id, defaultName);
      inputPerms.set(id + '_0', { gp: true, kb: false, slot: null });
      console.log("[viewer]", id, "(" + defaultName + ") joined (" + viewers.size + " total, " + controllerViewerCount() + " with controllers)");
      ws.send(JSON.stringify({ type: "your-id", viewerId: id, name: defaultName }));
      ws.send(JSON.stringify({ type: "input-state", gp: true, kb: false }));

      // Send viewer-joined so they immediately get a stream offer
      if (hostWS && hostWS.readyState === 1) {
        hostWS.send(JSON.stringify({ type: "viewer-joined", viewerId: id, name: defaultName }));
        if (hostStreaming) {
          ws.send(JSON.stringify({ type: "host-stream-ready" }));
        }
      }

      broadcastRoster();

      ws.on("message", raw => {
        try {
          const msg = JSON.parse(raw);

          // ── WebRTC signaling relay: answer / ice-viewer → host ──
          if (msg.type === "answer" || msg.type === "ice-viewer") {
            msg._viewerId = id;
            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify(msg));
            return;
          }

          // ── WebRTC signaling relay: host-not-streaming → viewer ──
          if (msg.type === "host-not-streaming") {
            const vws = viewers.get(msg.viewerId);
            if (vws && vws.readyState === 1) vws.send(JSON.stringify(msg));
            return;
          }

          // Viewer reconnected with the same ID — reuse slot, avoid duplicate entry
          if (msg.type === "viewer-rejoin") {
            const claimedId = msg.viewerId;
            if (claimedId && viewers.has(claimedId)) {
              const tempId = id;
              // Replace the stale WS entry with the new connection
              viewers.set(claimedId, ws);
              // Remove the temporary new-id we assigned so there's no dupe
              viewers.delete(tempId);
              viewerNames.set(claimedId, viewerNames.get(tempId) || viewerNames.get(claimedId) || "Guest");
              viewerNames.delete(tempId);

              if (viewerHasController.has(tempId)) {
                viewerHasController.delete(tempId);
                viewerHasController.add(claimedId);
              }

              console.log("[viewer]", claimedId, "rejoined (slot reused, no duplicate)");
              id = claimedId;

              // Tell host to immediately discard the temp connection and offer the real one
              if (hostWS && hostWS.readyState === 1) {
                hostWS.send(JSON.stringify({ type: "viewer-left", viewerId: tempId }));
                hostWS.send(JSON.stringify({ type: "viewer-joined", viewerId: id, name: viewerNames.get(id) }));
              }

              ws.send(JSON.stringify({ type: "your-id", viewerId: id, name: viewerNames.get(id) }));
              broadcastRoster();
            }
            return;
          }

          // Viewer asked host to re-send offer (e.g. after reconnect)
          if (msg.type === "request-offer") {
            if (hostWS && hostWS.readyState === 1)
              hostWS.send(JSON.stringify({ type: "viewer-joined", viewerId: id, name: viewerNames.get(id) || id }));
            return;
          }

          if (msg.type === "gpid") {
            const padIdx = msg.padIndex || 0;
            const pads = viewerGamepads.get(id) || new Set();

            // Deduplicate: ignore if this padIndex is already registered for this viewer
            if (pads.has(padIdx)) return;

            // Slot Cap: ignore if we already have 16 controllers total
            if (controllerViewerCount() >= 16) {
              console.log("[viewer] slot cap reached (16), ignoring controller from", id);
              return;
            }

            pads.add(padIdx);
            viewerGamepads.set(id, pads);

            msg.pad_id = id + '_' + padIdx;
            if (!inputPerms.has(msg.pad_id)) inputPerms.set(msg.pad_id, { gp: true, kb: false, slot: null });

            const isNewController = !viewerHasController.has(id);
            viewerHasController.add(id);

            if (isNewController) {
              playJoinSound();
              console.log("[viewer]", id, "controller detected — now counted (" + controllerViewerCount() + " with controllers)");
            }

            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-gpid", viewerId: id, id: msg.id }));
            toUinput(msg); // let sidecar detect controller type
            broadcastRoster();
            return;
          }
          if (msg.type === "set-name") {
            const name = sanitize(String(msg.name || '')).slice(0, 20) || viewerNames.get(id);
            viewerNames.set(id, name);
            ws.send(JSON.stringify({ type: "name-confirmed", name }));
            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-renamed", viewerId: id, name }));
            broadcastRoster();
            return;
          }
          if (msg.type === "chat") {
            msg.msg = sanitize(msg.msg);
            msg.from = sanitize(viewerNames.get(id) || msg.from || 'Guest').slice(0, 20);
            broadcast(JSON.stringify(msg));
            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify(msg));
            return;
          }
          if (msg.type === "gamepad" || msg.type === "keyboard") {
            const padIdx = msg.padIndex || 0;
            const rosterId = msg.type === "gamepad" ? id + '_' + padIdx : id + '_0';

            // Auto-register controller if we haven't seen gpid yet for this pad
            if (msg.type === "gamepad") {
              const pads = viewerGamepads.get(id) || new Set();
              if (!pads.has(padIdx)) {
                pads.add(padIdx);
                viewerGamepads.set(id, pads);
                if (!inputPerms.has(rosterId)) inputPerms.set(rosterId, { gp: true, kb: false, slot: null });

                const isNew = !viewerHasController.has(id);
                viewerHasController.add(id);
                if (isNew) {
                  playJoinSound();
                  console.log("[viewer]", id, "controller auto-detected from input");
                }
                broadcastRoster();
              }
            }

            const perms = inputPerms.get(rosterId) || { gp: true, kb: false };
            if (msg.type === "gamepad" && !perms.gp) {
              console.log("[viewer]", id, "gamepad blocked (permissions disabled)");
              return;
            }
            if (msg.type === "keyboard" && !perms.kb) {
              console.log("[viewer]", id, "keyboard blocked (permissions disabled)");
              return;
            }

            msg.pad_id = rosterId;
            toUinput(msg);
            return;
          }
        } catch { }
      });

      ws.on("close", () => {
        const hadController = viewerHasController.has(id);
        const wasActive = viewers.get(id) === ws;
        
        // Only remove if this specific connection is the active one for this ID
        if (wasActive) {
          viewers.delete(id);
          viewerNames.delete(id);
          viewerGamepads.delete(id);
          viewerHasController.delete(id);
          
          if (hadController) {
            playLeaveSound();
            // Send a zero/neutral flush before destroying — prevents stuck D-pad / joystick
            toUinput({ type: 'flush_neutral', viewer_id: id });
            // Then destroy all virtual controllers for this viewer
            toUinput({ type: 'disconnect_viewer', viewer_id: id });
          }

          broadcastRoster();
          if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-left", viewerId: id }));
        }

        console.log("[viewer]", id, "left (" + viewers.size + " total, " + controllerViewerCount() + " with controllers)");
      });

      // ── ARCADE CLIENTS (arcade.js subscribers at nearsec.cutefame.net/arcade) ─
    } else if (path === "/ws/arcade") {
      arcadeClients.add(ws);
      // Immediately send all current sessions so the page doesn't wait for a change
      ws.send(JSON.stringify({ type: 'arcade-sessions', sessions: [...arcadeSessions.values()] }));
      ws.on("message", raw => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'arcade-query') {
            ws.send(JSON.stringify({ type: 'arcade-sessions', sessions: [...arcadeSessions.values()] }));
          }
        } catch { }
      });
      ws.on("close", () => arcadeClients.delete(ws));

      // ── AUDIO (WebSocket fallback — WebRTC carries audio natively) ────────────
    } else if (path === "/ws/audio-host") {
      ws.on("message", raw => { audioViewers.forEach(v => { if (v.readyState === 1) v.send(raw); }); });

    } else if (path === "/ws/audio") {
      audioViewers.add(ws);
      ws.on("close", () => audioViewers.delete(ws));

      // ── DEDICATED INPUT CHANNEL ───────────────────────────────────────────────
    } else if (path === "/ws/input") {
      let myId = null;
      ws.on("message", raw => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "identify") { myId = msg.viewerId; console.log("[input] identified as", myId); return; }
          if (msg.type === "gpid") {
            if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-gpid", viewerId: myId, id: msg.id }));
            return;
          }
          if (msg.type === "gamepad") { toUinput(msg); return; }
          if (msg.type === "keyboard") {
            if (!myId) return;
            const perms = inputPerms.get(myId) || { gp: true, kb: false };
            if (!perms.kb) return;
            toUinput(msg);
            return;
          }
        } catch (e) { console.error("[input] error:", e.message); }
      });
    }
  });

  // Reap dead WebSockets every 30 seconds
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  server.listen(PORT, "0.0.0.0", async () => {
    console.log("Listening on port " + PORT);
    if (!process.env.ELECTRON_MODE) openBrowser("http://localhost:" + PORT + "/host");
      const cfg = loadConfig();
    if (cfg.neverAsk && cfg.tunnelProvider === 'portforward') {
      // Port-forward mode: no tunnel process needed. Host shares their public IP directly.
      // tunnelUrl stays null here; the host page reads neverAsk=true and skips the picker modal.
      console.log("  ~ Tunnel: port forward mode (saved). Share your Public IP URL with viewers.");
    } else if (cfg.neverAsk && cfg.tunnelProvider) {
      // Use saved preference without asking
      console.log("  ~ Tunnel: using saved provider '" + cfg.tunnelProvider + "' (edit nearsectogether.config.json to change)");
      const fn = {
        zrok: startTunnelZrok,
        cloudflared: startTunnelCloudflared,
        playit: startTunnelPlayit,
        localhostrun: startTunnelLocalhostRun,
        serveo: startTunnelServeo,
        vps: (p) => startTunnelVps(p, cfg.vpsHost || process.env.VPS_HOST || '')
      }[cfg.tunnelProvider] || startTunnel;
      const tun = await fn(PORT);
      if (tun) {
        tunnelUrl = tun.url;
        if (hostWS && hostWS.readyState === 1)
          hostWS.send(JSON.stringify({ type: "tunnel-url", url: tunnelUrl }));
      }
    } else {
      // No saved preference — host page will show the picker modal
      console.log("  ~ Tunnel: waiting for host to choose provider...");
    }
  });
}

main();

function cleanupAndExit() {
  console.log("\n  \x1b[33m!\x1b[0m Shutting down... cleaning up ports.");
  if (activeTunnelProc) {
    try { activeTunnelProc.kill(); } catch (e) { }
  }
  // Try to kill local port 3000 cross-platform
  killPort(3000).catch(err => {
    // Port might not have been in use, or already closed - that's OK
  });
  process.exit();
}
process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
