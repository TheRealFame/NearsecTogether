export async function onRequestPost(context) {
    const formData = await context.request.formData();
    const socketId = formData.get('socket_id');
    const channelName = formData.get('channel_name');

    const secret = "ee208da1939a3b1cc025";
    const key = "a3560ec7b7f5161460a1";
    const stringToSign = `${socketId}:${channelName}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    const cryptoKey = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(stringToSign));
    const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('');

    return new Response(JSON.stringify({ auth: `${key}:${hexSignature}` }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
