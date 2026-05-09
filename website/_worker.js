export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Intercept the Pusher Auth Route
    if (url.pathname === "/api/pusher-auth" && request.method === "POST") {
      const formData = await request.formData();
      const socketId = formData.get("socket_id");
      const channelName = formData.get("channel_name");
      
      // Pulling your keys securely from Cloudflare Settings
      const secret = env.PUSHER_SECRET;
      const key = env.PUSHER_KEY;
      
      const stringToSign = `${socketId}:${channelName}`;
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );

      const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(stringToSign));
      const hash = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");

      return new Response(JSON.stringify({ auth: `${key}:${hash}` }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Fallback: Serve the static HTML/JS site from the 'dist' folder
    return env.ASSETS.fetch(request);
  }
};
