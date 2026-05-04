# Troubleshooting WebRTC Connections

Nearsec Together uses **WebRTC** for all video, audio, and input data. WebRTC is a peer-to-peer technology, which means after the initial handshake, traffic flows directly between the host and viewer — not through any server.

This is great for latency, but it requires **ICE negotiation** to succeed first. This guide explains what can go wrong and how it has been mitigated.

---

## Why connections fail — the short version

WebRTC uses a system called **ICE (Interactive Connectivity Establishment)** to find a direct path between two computers. It tries candidates in this order:

| Type | How it works | Works behind NAT? |
|------|-------------|-------------------|
| **host** | Direct LAN IP | ✅ LAN only |
| **srflx** (STUN) | Discovers public IP via STUN server | ✅ Cone NAT, ❌ Symmetric NAT |
| **relay** (TURN) | Relays traffic through a TURN server | ✅ Always |

The problem: **most home routers use Symmetric NAT**, which STUN cannot penetrate. Without TURN servers, two people on different home networks will fail to connect ~90% of the time, even though their WebSocket (signaling) connection works fine. This is exactly why input worked but video didn't.

---

## What this app does to fix it

### 1. TURN Servers (primary fix)
Both the host and viewer `RTCPeerConnection` include [OpenRelay](https://www.metered.ca/tools/openrelay/) — a free, open-source public TURN service:

```js
{ urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
{ urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
```

When a direct P2P path fails, ICE automatically falls back to routing through OpenRelay. The video still flows — just with slightly higher latency (~20–40ms extra) compared to a direct connection.

### 2. ICE Candidate Buffering
ICE candidates from the host can arrive at the viewer's WebSocket **before** the offer message does. Without buffering, those candidates are silently dropped, leaving only late/broken candidates. The viewer now queues all early candidates and flushes them immediately after `setRemoteDescription` completes.

### 3. Multiple STUN Servers
4 STUN servers are used (Google + Cloudflare) to maximize the chance of discovering a working public IP address.

### 4. Viewer Reconnect Deduplication
When a viewer's WebSocket drops and reconnects, they send a `viewer-rejoin` message with their existing viewer ID. The server reuses their slot instead of creating a new one, preventing the roster from flooding with duplicate ghost entries.

### 5. Auto-retry on ICE failure
If `connectionState` reaches `failed`, the host automatically closes the stale PeerConnection and re-sends a fresh offer to that viewer after 1 second.

---

## If a viewer still cannot connect

1. **Ask the viewer to open the browser console** (F12 → Console). Look for `ICE connection state: failed` — if that appears but `dtls transport` never appears, the TURN relay also failed, which usually means the viewer's network blocks outbound UDP entirely (corporate firewalls, etc.).

2. **Try the `turns:` (TLS) TURN entry** — it runs over TCP port 443, which is almost never blocked.

3. **Self-host a TURN server** — If you need guaranteed connectivity for all networks, run [coturn](https://github.com/coturn/coturn) on a cheap VPS and add your own credentials to the `iceServers` array.

---

## Latency guide

| Scenario | Expected added latency |
|----------|----------------------|
| Both on same LAN | ~1–5ms |
| Direct P2P over internet (STUN) | ~20–80ms |
| Relayed via TURN (OpenRelay) | ~40–120ms |
| Through Cloudflare Tunnel (signaling only) | +0ms (tunnel not used after handshake) |
