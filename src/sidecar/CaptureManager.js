/**
 * src/sidecar/CaptureManager.js
 * Unified Orchestrator for all Capture Methods.
 */
'use strict';

const { spawn, execSync } = require('child_process');
const os = require('os');
const http = require('http');
const fs = require('fs');

class CaptureManager {
    constructor() {
        this._activeMethod = null;

        // FFmpeg specific state
        this._ffmpegProc = null;
        this._ffmpegServer = null;
        this._ffmpegPort = null;
        this._ffmpegStreamRes = null;
        this._ffmpegEncoder = null;
    }

    /**
     * @param {string} method - 'ffmpeg', 'webcodecs', or 'webrtc'
     * @param {object} options - Resolution, FPS, Bitrate, etc.
     */
    async start(method, options = {}) {
        if (this._activeMethod) {
            await this.stop();
        }

        console.log(`[CaptureManager] Arming capture pipeline: ${method.toUpperCase()}`);
        this._activeMethod = method;

        switch (method) {
            case 'ffmpeg':
                return await this._startFFmpeg(options);
            case 'webcodecs':
                // Backend just tracks state; host.js executes the DOM VideoEncoder
                return { ok: true, message: 'WebCodecs armed on backend. Waiting for frontend execution.' };
            case 'webrtc':
                // Backend just tracks state; host.js handles native Wayland portal
                return { ok: true, message: 'Native WebRTC armed on backend.' };
            default:
                this._activeMethod = null;
                throw new Error(`[CaptureManager] Unknown capture method requested: ${method}`);
        }
    }

    async stop() {
        console.log(`[CaptureManager] Disarming pipeline: ${this._activeMethod || 'None'}`);

        if (this._activeMethod === 'ffmpeg') {
            this._stopFFmpeg();
        }

        this._activeMethod = null;
        return { ok: true };
    }

    getStatus() {
        return {
            active: this._activeMethod !== null,
            method: this._activeMethod,
            details: this._activeMethod === 'ffmpeg' ? `FFmpeg via ${this._ffmpegEncoder}` : 'Frontend Execution'
        };
    }

    // ── FFmpeg Implementation (Isolated) ──

    async _startFFmpeg({ width = 1920, height = 1080, fps = 60, bitrate = 8000000 }) {
        if (os.platform() !== 'linux') throw new Error('FFmpeg experimental capture only supports Linux.');

        this._ffmpegEncoder = this._detectFFmpegEncoder();
        const display = process.env.DISPLAY || ':0';

        // Spin up the fragmented MP4 local server
        if (!this._ffmpegServer) {
            this._ffmpegServer = http.createServer((req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'video/mp4',
                    'Cache-Control': 'no-cache',
                    'Access-Control-Allow-Origin': '*'
                });
                this._ffmpegStreamRes = res;
                if (this._ffmpegProc && this._ffmpegProc.stdout) this._ffmpegProc.stdout.pipe(res);
            });
            await new Promise((resolve) => {
                this._ffmpegServer.listen(0, '127.0.0.1', () => {
                    this._ffmpegPort = this._ffmpegServer.address().port;
                    resolve();
                });
            });
        }

        let args;
        if (this._ffmpegEncoder === 'vaapi') {
            args = ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-framerate', String(fps), '-video_size', `${width}x${height}`, '-i', display, '-vf', 'format=nv12,hwupload', '-vaapi_device', this._detectVaapiDevice(), '-c:v', 'h264_vaapi', '-profile:v', 'high', '-level', '4.2', '-b:v', `${Math.round(bitrate / 1000)}k`, '-bf', '0', '-g', String(fps * 2), '-tune', 'zerolatency', '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', 'pipe:1'];
        } else {
            args = ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-framerate', String(fps), '-video_size', `${width}x${height}`, '-i', display, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', `${Math.round(bitrate / 1000)}k`, '-bf', '0', '-g', String(fps * 2), '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', 'pipe:1'];
        }

        this._ffmpegProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
        if (this._ffmpegStreamRes) this._ffmpegProc.stdout.pipe(this._ffmpegStreamRes);

        this._ffmpegProc.on('error', (e) => console.error('[CaptureManager] FFmpeg Error:', e.message));
        this._ffmpegProc.on('close', () => { this._activeMethod = null; });

        return { ok: true, message: `FFmpeg running on ${this._ffmpegEncoder}`, port: this._ffmpegPort };
    }

    _stopFFmpeg() {
        if (this._ffmpegProc) {
            try { this._ffmpegProc.kill('SIGTERM'); } catch (_) {}
            this._ffmpegProc = null;
        }
        if (this._ffmpegStreamRes) {
            this._ffmpegStreamRes.end();
            this._ffmpegStreamRes = null;
        }
        if (this._ffmpegServer) {
            this._ffmpegServer.close();
            this._ffmpegServer = null;
            this._ffmpegPort = null;
        }
    }

    _detectFFmpegEncoder() {
        try {
            const encs = execSync('ffmpeg -hide_banner -encoders 2>/dev/null', { encoding: 'utf8' });
            if (encs.includes('h264_vaapi') || encs.includes('vp9_vaapi')) return 'vaapi';
        } catch (_) {}
        return 'software';
    }

    _detectVaapiDevice() {
        try {
            const nodes = fs.readdirSync('/dev/dri').filter(n => n.startsWith('renderD'));
            if (nodes.length > 0) return `/dev/dri/${nodes[0]}`;
        } catch (_) {}
        return '/dev/dri/renderD128';
    }
}

module.exports = new CaptureManager();
