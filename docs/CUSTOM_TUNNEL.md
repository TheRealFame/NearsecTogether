# Custom Cloudflare Tunnel Setup

By default, Nearsec Together uses a **random URL** every time you launch it (e.g. `https://random-words.trycloudflare.com`). This means you have to paste a new link to your friends on every session.

If you want a **permanent, consistent URL** (e.g. `https://play.yourdomain.com`) that never changes, follow this guide.

---

## Requirements

- A domain you own (any registrar is fine)
- A free [Cloudflare account](https://cloudflare.com) with your domain added and its nameservers pointed to Cloudflare

---

## Step 1 — Create the Tunnel

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. In the left sidebar, click **Networks → Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as the connector type
5. Give it a name (e.g. `Nearsec Together`)
6. Click **Save tunnel**

---

## Step 2 — Get your Token

After saving, Cloudflare will show you an installation command like:

```
cloudflared service install eyJhIjoiMWEz...
```

**Copy the long token** (everything after `install ` — just the `eyJ...` part).

---

## Step 3 — Add a Public Hostname

1. Still in the tunnel editor, click the **Public Hostname** tab
2. Click **Add a public hostname**
3. Fill in the fields exactly like this:

| Field | Value |
|-------|-------|
| **Subdomain** | `play` (or anything you like) |
| **Domain** | Select your domain from the dropdown |
| **Path** | *(leave blank)* |
| **Service Type** | `HTTP` |
| **URL** | `localhost:3000` |

4. Click **Save hostname**

Cloudflare will automatically create the DNS record for you.

---

## Step 4 — Create your `.env` file

In the root of the Nearsec Together folder, create a file called **`.env`** (note the leading dot):

```
CF_TOKEN=eyJhIjoiMWEz...your_full_token_here...
CUSTOM_URL=https://play.yourdomain.com
```

> [!IMPORTANT]
> The `.env` file is listed in `.gitignore` and will **never** be uploaded to GitHub. Your token is safe.

---

## Step 5 — Launch

Start Nearsec Together normally (`./stream.sh`). When the tunnel picker appears, select **cloudflared**. The app will detect your token and use your persistent domain instead of a random URL.

The terminal will confirm:
```
  ✓ Tunnel URL: https://play.yourdomain.com
```

---

## Why not just port-forward?

Port forwarding requires you to expose your public IP directly, which:
- Changes every time your ISP reassigns it (DHCP)
- Doesn't work at all behind CG-NAT (very common with ISPs in 2024+)
- Requires opening firewall rules that persist

The Cloudflare tunnel approach routes traffic through Cloudflare's edge — your IP is never exposed and nothing needs to be opened on your router.
