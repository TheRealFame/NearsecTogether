export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // ROUTE 0: DIAGNOSTIC (Delete this later!)
    // ==========================================
    if (url.pathname === "/api/debug-env") {
      return new Response(JSON.stringify({
        hasRawgKey: !!env.RAWG_API_KEY,
        hasPusherSecret: !!env.PUSHER_SECRET,
        hasPusherKey: !!env.PUSHER_KEY,
        rawgLength: env.RAWG_API_KEY ? env.RAWG_API_KEY.length : 0
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // ==========================================
    // ROUTE 1: Pusher Authentication (POST)
    // ==========================================
    if (url.pathname === "/api/pusher-auth") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed. This endpoint requires POST.", { status: 405 });
      }

      try {
        const formData = await request.formData();
        const socketId = formData.get("socket_id");
        const channelName = formData.get("channel_name");

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
      } catch (err) {
        // This will spit the exact crash reason back to the browser console!
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ==========================================
    // ROUTE 2: RAWG Game Art API (GET)
    // ==========================================
    if (url.pathname === "/api/game-art") {
      const title = url.searchParams.get('title');

      if (!title) {
        return new Response(JSON.stringify({ thumbnail: '' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const apiKey = env.RAWG_API_KEY;

      try {
        const res = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(title)}&key=${apiKey}&page_size=1`);
        const data = await res.json();

        let thumb = '';
        if (data.results && data.results.length > 0) {
          thumb = data.results[0].background_image;
        }

        return new Response(JSON.stringify({ thumbnail: thumb }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ thumbnail: '' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ==========================================
    // FALLBACK: Serve the Static Arcade site
    // ==========================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Assets not bound correctly", { status: 500 });
  }
};
