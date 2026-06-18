const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws/input');
ws.on('open', () => {
    console.log("Connected to /ws/input");
    ws.send(JSON.stringify({ type: 'identify', viewerId: 'v1' }));
    setTimeout(() => {
        const payload = {
            event: 'keydown',
            key: 'KEY_W',
            type: 'keyboard',
            viewerId: 'v1',
            pad_id: 'v1_0'
        };
        console.log("Sending payload:", payload);
        ws.send(JSON.stringify(payload));
    }, 500);
    setTimeout(() => {
        ws.close();
        process.exit(0);
    }, 1000);
});
ws.on('error', (err) => console.error(err));
