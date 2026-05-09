export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Intercept the Pusher Route
    if (url.pathname === "/api/pusher-auth") {
      
      // If a browser visits (GET), reject it gracefully with a 405
      if (request.method !== "POST") {
        return new Response("Method Not Allowed. This endpoint requires POST.", { status: 405 });
      }

      // If Pusher visits (POST), run the auth logic
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
        // Catch any internal auth errors so it doesn't throw an 1101
        return new Response("Auth Processing Error", { status: 500 });
      }
    }

    // 2. Serve the Static Arcade site
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    
    return new Response("Assets not bound correctly", { status: 500 });
  }
};
