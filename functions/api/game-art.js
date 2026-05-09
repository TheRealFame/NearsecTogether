export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const title = url.searchParams.get('title');

    if (!title) {
        return new Response(JSON.stringify({ thumbnail: '' }), { status: 400 });
    }

    // This grabs the secret key from your Cloudflare settings (we'll set this up next)
    const apiKey = context.env.RAWG_API_KEY;

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
        return new Response(JSON.stringify({ thumbnail: '' }), { status: 500 });
    }
}
