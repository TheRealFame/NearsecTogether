const express = require("express");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const os = require("os");
const net = require("net");
const fs = require("fs");
const { exec, spawn } = require("child_process");

// Parse optional .env file for secrets
try {
  fs.readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) process.env[match[1]] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
  });
} catch (e) {}

function getLanIP() {
  for (const iface of Object.values(os.networkInterfaces()))
    for (const n of iface)
      if (n.family === "IPv4" && !n.internal) return n.address;
  return "127.0.0.1";
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
function openBrowser(url) { exec("xdg-open " + url, () => { }); }
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
    exec("which cloudflared", err => {
      if (err) return resolve(null);
      
      // If the user provided a token in .env (Remotely Managed)
      if (process.env.CF_TOKEN) {
        console.log("  \x1b[33m~\x1b[0m Starting persistent Cloudflare tunnel (Token)...");
        const proc = spawn("cloudflared", ["tunnel", "--no-autoupdate", "run", "--token", process.env.CF_TOKEN], { stdio: ["ignore", "pipe", "pipe"] });
        const url = process.env.CUSTOM_URL || "https://your-custom-domain.com";
        console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + url + "\x1b[0m");
        return resolve({ url, proc });
      }

      // If the user provided a tunnel name in .env (Locally Managed - "The old way")
      if (process.env.CF_TUNNEL_NAME) {
        console.log("  \x1b[33m~\x1b[0m Starting persistent Cloudflare tunnel (Locally Managed)...");
        const proc = spawn("cloudflared", ["tunnel", "run", process.env.CF_TUNNEL_NAME], { stdio: ["ignore", "pipe", "pipe"] });
        const url = process.env.CUSTOM_URL || "https://your-custom-domain.com";
        console.log("  \x1b[32m✓\x1b[0m Tunnel URL: \x1b[1m" + url + "\x1b[0m");
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
    });
  });
}

function startTunnelPlayit(port) {
  return new Promise(resolve => {
    exec("which playit", err => {
      if (err) return resolve(null);
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
    });
  });
}

function startTunnelLocalhostRun(port) {
  return new Promise(resolve => {
    exec("which ssh", err => {
      if (err) return resolve(null);
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
    });
  });
}

function startTunnelServeo(port) {
  // serveo.net — SSH-based like localhost.run, different server, often works when lr is blocked
  return new Promise(resolve => {
    exec("which ssh", err => {
      if (err) return resolve(null);
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
    });
  });
}

async function startTunnel(port) {
  const forced = (process.env.TUNNEL || "").toLowerCase();
  if (forced === "cloudflared") return startTunnelCloudflared(port);
  if (forced === "playit") return startTunnelPlayit(port);
  if (forced === "localhostrun") return startTunnelLocalhostRun(port);
  if (forced === "serveo") return startTunnelServeo(port);
  // Auto: try each in order (SSH providers run in parallel to save time)
  const cf = await startTunnelCloudflared(port);
  if (cf) return cf;
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

// ── Persistent config (tunnel preference) ────────────────────────────────────
const CONFIG_FILE = __dirname + "/web-stream.config.json";
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function saveConfig(updates) {
  const cfg = { ...loadConfig(), ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

async function main() {
  const PORT = await findFreePort(3000);
  const LAN_IP = getLanIP();
  const PUBLIC_IP = await getPublicIP();
  let PIN = makePin();
  let pinEnabled = true;
  let tunnelUrl = null;

  console.log("\n  \x1b[1mNearsec Together\x1b[0m");
  console.log("  Host page : http://localhost:" + PORT + "/host");
  console.log("  LAN URL   : http://" + LAN_IP + ":" + PORT + "/");
  if (PUBLIC_IP) console.log("  Public IP : http://" + PUBLIC_IP + ":" + PORT + "/ (needs port forward)");
  console.log("  PIN       : \x1b[1;32m" + PIN + "\x1b[0m\n");

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Security headers — required for Gamepad API + display-capture over HTTPS/Cloudflare
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "gamepad=*, display-capture=(self)");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/", (req, res) => res.sendFile(__dirname + "/public/index.html"));
  app.get("/host", (req, res) => res.sendFile(__dirname + "/public/host.html"));
  app.get("/api/info", (req, res) => res.json({ lanIP: LAN_IP, port: PORT, pin: PIN, publicIP: PUBLIC_IP || null, tunnelUrl: tunnelUrl || null }));
  app.get("/api/pin-required", (req, res) => res.json({ required: pinEnabled }));
  app.get("/api/config", (req, res) => res.json(loadConfig()));
  app.post("/api/config", express.json(), (req, res) => { res.json(saveConfig(req.body || {})); });

  // Trigger a tunnel start from the host UI picker
  app.post("/api/start-tunnel", express.json(), async (req, res) => {
    if (tunnelUrl) return res.json({ url: tunnelUrl }); // already running
    const provider = (req.body && req.body.provider) || "cloudflared";
    if (req.body && req.body.remember) saveConfig({ tunnelProvider: provider, neverAsk: true });
    if (req.body && req.body.remember === false) saveConfig({ neverAsk: false }); // clear preference
    res.json({ ok: true, starting: true });
    // Start asynchronously so the response returns immediately
    const fn = { cloudflared: startTunnelCloudflared, playit: startTunnelPlayit, localhostrun: startTunnelLocalhostRun }[provider] || startTunnel;
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
  const sidecar = __dirname + "/input_driver.py";
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  if (fs.existsSync(sidecar)) {
    uinputProc = spawn(pythonCmd, [sidecar], { stdio: ["pipe", "inherit", "inherit"], detached: false });
    uinputProc.stdin.on("error", () => { });
    uinputProc.on("error", e => console.log("[uinput] spawn error:", e.message));
    uinputProc.on("close", () => { uinputProc = null; console.log("[uinput] sidecar exited"); });
    console.log("[uinput] sidecar started");
  }

  function toUinput(msg) {
    if (!uinputProc || !uinputProc.stdin.writable) return;
    setImmediate(() => { try { uinputProc.stdin.write(JSON.stringify(msg) + "\n"); } catch { } });
  }

  let hostWS = null;
  const viewers = new Map();
  const audioViewers = new Set();
  const inputPerms = new Map();
  const viewerNames = new Map();
  const viewerGamepads = new Map(); // viewerId -> Set of padIndices
  let vidCount = 0;

  function broadcast(data) {
    viewers.forEach(vws => { if (vws.readyState === 1) vws.send(data); });
  }

  function broadcastRoster() {
    const roster = [];
    viewers.forEach((_, id) => {
      const pads = viewerGamepads.get(id) || new Set([0]); // Default 1 row for keyboard/first pad
      pads.forEach(padIdx => {
        const isExtra = padIdx > 0;
        const nameSuffix = isExtra ? ' ' + (padIdx + 1) : '';
        const rosterId = id + '_' + padIdx;
        const p = inputPerms.get(rosterId) || { gp: true, kb: false, slot: null };
        roster.push({
          id: rosterId,
          name: (viewerNames.get(id) || id) + nameSuffix,
          gp: !!p.gp,
          kb: isExtra ? false : !!p.kb, // Only the first slot gets the keyboard
          slot: p.slot ?? null
        });
      });
    });
    const msg = JSON.stringify({ type: "roster", viewers: roster });
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
          // Fallback broadcast (host-stream-stopped etc.)
          broadcast(JSON.stringify(msg));
        } catch { }
      });

      ws.on("close", () => {
        console.log("[host] disconnected");
        hostWS = null;
        broadcast(JSON.stringify({ type: "host-disconnected" }));
      });

      // ── VIEWER ───────────────────────────────────────────────────────────────
    } else if (path === "/ws/viewer") {
      if (pinEnabled && pin !== PIN) {
        try { ws.send(JSON.stringify({ type: "pin-rejected" })); } catch { }
        ws.close();
        console.log("[viewer] rejected — wrong PIN");
        return;
      }
      const id = "v" + (++vidCount);
      const defaultName = "Guest" + (1000 + Math.floor(Math.random() * 9000));
      viewers.set(id, ws);
      viewerNames.set(id, defaultName);
      inputPerms.set(id + '_0', { gp: true, kb: false, slot: null });
      console.log("[viewer]", id, "(" + defaultName + ") joined (" + viewers.size + " total)");
      ws.send(JSON.stringify({ type: "your-id", viewerId: id, name: defaultName }));
      ws.send(JSON.stringify({ type: "input-state", gp: true, kb: false }));
      if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-joined", viewerId: id, name: defaultName }));
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
              // Replace the stale WS entry with the new connection
              viewers.set(claimedId, ws);
              // Remove the temporary new-id we assigned so there's no dupe
              viewers.delete(id);
              viewerNames.set(claimedId, viewerNames.get(id) || viewerNames.get(claimedId) || "Guest");
              viewerNames.delete(id);
              
              // We don't overwrite inputPerms here because they are keyed by viewerId_padIndex and persist naturally
              
              console.log("[viewer]", claimedId, "rejoined (slot reused, no duplicate)");
              // id is now meaningless — point it at the real id for future msgs
              id = claimedId;
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
            const pads = viewerGamepads.get(id) || new Set([0]);
            pads.add(padIdx);
            viewerGamepads.set(id, pads);
            
            msg.pad_id = id + '_' + padIdx;
            if (!inputPerms.has(msg.pad_id)) inputPerms.set(msg.pad_id, { gp: true, kb: false, slot: null });
            
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
            const perms = inputPerms.get(rosterId) || { gp: true, kb: false };
            
            if (msg.type === "gamepad" && !perms.gp) return;
            if (msg.type === "keyboard" && !perms.kb) return;
            
            msg.pad_id = rosterId;
            toUinput(msg);
            return;
          }
        } catch { }
      });

      ws.on("close", () => {
        viewers.delete(id); viewerNames.delete(id); viewerGamepads.delete(id);
        // We leave inputPerms intact in case they F5 refresh to reclaim their spot!
        
        // Ensure all virtual controllers for this viewer are strictly destroyed
        toUinput({ type: 'disconnect_viewer', viewer_id: id });
        
        console.log("[viewer]", id, "left (" + viewers.size + " total)");
        if (hostWS && hostWS.readyState === 1) hostWS.send(JSON.stringify({ type: "viewer-left", viewerId: id }));
        broadcastRoster();
      });

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
    if (cfg.neverAsk && cfg.tunnelProvider) {
      // Use saved preference without asking
      console.log("  ~ Tunnel: using saved provider '" + cfg.tunnelProvider + "' (edit web-stream.config.json to change)");
      const fn = { cloudflared: startTunnelCloudflared, playit: startTunnelPlayit, localhostrun: startTunnelLocalhostRun }[cfg.tunnelProvider] || startTunnel;
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
