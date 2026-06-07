const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── Shared Buffers for Zero-Copy Native C++ Submission ──
const _gpBuf = Buffer.alloc(14);
const _alBuf = Buffer.alloc(40);
const _flBuf = Buffer.alloc(2);
const _frBuf = Buffer.alloc(2);

_alBuf[0] = 0x03; // ALLOCATE
_flBuf[0] = 0x02; // FLUSH
_frBuf[0] = 0x04; // FREE

// ── State ──────────────────────────────────────────────────────────────────────
const viewerSlots    = new Map();
const slotViewers    = new Map();
const viewerCtrlType = new Map();
const viewerModes    = new Map();

// KBM Emulation State
const kbmStates      = new Map();

// Tracks millisecond activity for Auto-Eviction
const slotLastUsed   = new Map();

let _bridge = null;
let _pythonProc = null;
let GAME_PROFILES = {};
let KBM_BINDINGS = { keys: {}, mouse: { sensitivity: 1.5, deadzone: 0.1 } };

const KBM_BTN_MAP = {
    'A': 0x0001, 'B': 0x0002, 'X': 0x0004, 'Y': 0x0008,
    'UP': 0x0010, 'DOWN': 0x0020, 'LEFT': 0x0040, 'RIGHT': 0x0080,
    'LB': 0x0100, 'RB': 0x0200, 'L3': 0x0400, 'R3': 0x0800,
    'START': 0x1000, 'SELECT': 0x2000, 'GUIDE': 0x4000
};

const PROFILES = {
    xbox360:   { vendor: 0x045E, product: 0x028E, version: 0x0114, name: "Microsoft X-Box 360 pad" },
    xboxone:   { vendor: 0x045E, product: 0x02EA, version: 0x0301, name: "Microsoft X-Box One S pad" },
    ds4:       { vendor: 0x054C, product: 0x05C4, version: 0x8111, name: "Sony Computer Entertainment Wireless Controller" },
    dualsense: { vendor: 0x054C, product: 0x0CE6, version: 0x8111, name: "Sony Interactive Entertainment Wireless Controller" },
    switchpro: { vendor: 0x0500, product: 0x2009, version: 0x8111, name: "Nintendo Switch Pro Controller" }
};

// ── Initialization ─────────────────────────────────────────────────────────────
function init(screenWidth, screenHeight) {
    _loadProfiles();

    // 1. Try Native C++ Fast Lane
    try {
        const nodePath = path.join(__dirname, 'build', 'Release', 'uinputBridge.node');
        _bridge = require(nodePath);
        _bridge.initializeDevice(screenWidth || 1920, screenHeight || 1080);
        console.log(`[input] Native uinputBridge loaded: ${nodePath}`);
        return true;
    } catch (e) {
        console.warn(`[input] Native bridge failed to load (${e.message}). Falling back to Python.`);
        _bridge = null;
    }

    // 2. Fallback to Python Sidecar
    const pythonScript = path.join(__dirname, 'linux_uinput.py');
    if (!fs.existsSync(pythonScript)) {
        console.error(`[input] FATAL: Python fallback not found at ${pythonScript}`);
        return false;
    }

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    _pythonProc = spawn(pythonCmd, [pythonScript], { stdio: ["pipe", "pipe", "inherit"] });
    _pythonProc.on("error", e => console.error("[uinput] Python spawn error:", e.message));
    _pythonProc.on("close", () => { _pythonProc = null; console.log("[uinput] Python sidecar exited"); });

    console.log("[input] Python sidecar fallback started.");
    return true;
}

function _loadProfiles() {
    try {
        const pth = path.join(__dirname, '..', '..', '..', 'config', 'game_profiles.csv');
        if (fs.existsSync(pth)) {
            const lines = fs.readFileSync(pth, 'utf8').split('\n');
            lines.forEach(line => {
                const [title, ctrl, kbm, hybrid] = line.split(',').map(s => s?.trim());
                if (title && ctrl) GAME_PROFILES[title.toLowerCase()] = { ctrl, kbm, hybrid: hybrid === 'true' };
            });
            console.log(`[input] CSV database loaded ${Object.keys(GAME_PROFILES).length} profiles.`);
        }
    } catch (e) { console.warn('[input] Failed to load CSV:', e.message); }

    try {
        const pth = path.join(__dirname, '..', '..', '..', 'config', 'kbm_bindings.json');
        if (fs.existsSync(pth)) {
            KBM_BINDINGS = JSON.parse(fs.readFileSync(pth, 'utf8'));
            console.log('[input] JSON KBM fallback loaded.');
        }
    } catch (e) { console.warn('[input] Failed to load KBM JSON:', e.message); }
}

// ── Slot Allocator & LRU Garbage Collection ────────────────────────────────────
function _allocateSlot(viewerId, profileKey) {
    if (viewerSlots.has(viewerId)) {
        const s = viewerSlots.get(viewerId);
        slotLastUsed.set(s, Date.now());
        return s;
    }

    for (let i = 0; i < 16; i++) {
        if (!slotViewers.has(i)) {
            _claimSlot(i, viewerId, profileKey);
            return i;
        }
    }

    // SLOTS FULL: Evict oldest inactive controller
    let oldestSlot = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < 16; i++) {
        const t = slotLastUsed.get(i) || 0;
        if (t < oldestTime) {
            oldestTime = t;
            oldestSlot = i;
        }
    }

    if (oldestSlot >= 0) {
        console.warn(`[input] Slot limit reached. Auto-evicting inactive slot ${oldestSlot}`);
        const owner = slotViewers.get(oldestSlot);
        _freeSlot(owner);
        _claimSlot(oldestSlot, viewerId, profileKey);
        return oldestSlot;
    }

    console.error('[input] FATAL: No free gamepad slots available');
    return -1;
}

function _claimSlot(slotIndex, viewerId, profileKey) {
    viewerSlots.set(viewerId, slotIndex);
    slotViewers.set(slotIndex, viewerId);
    slotLastUsed.set(slotIndex, Date.now());

    if (!_bridge) return; // Python handles its own slots

    const profile = PROFILES[profileKey] || PROFILES.xbox360;
    _alBuf[1] = slotIndex;
    _alBuf.writeUInt16LE(profile.vendor,  2);
    _alBuf.writeUInt16LE(profile.product, 4);
    _alBuf.writeUInt16LE(profile.version, 6);
    _alBuf.fill(0, 8, 8 + 32);
    Buffer.from(profile.name).copy(_alBuf, 8, 0, Math.min(31, profile.name.length));

    _bridge.submitInputPacket(_alBuf);
}

function _freeSlot(viewerId) {
    const slot = viewerSlots.get(viewerId);
    if (slot === undefined) return;

    if (_bridge) {
        _flBuf[1] = slot;
        _bridge.submitInputPacket(_flBuf);
        _frBuf[1] = slot;
        _bridge.submitInputPacket(_frBuf);
    }

    viewerSlots.delete(viewerId);
    slotViewers.delete(slot);
    slotLastUsed.delete(slot);
    kbmStates.delete(viewerId);
}

// ── Emulation Handlers ─────────────────────────────────────────────────────────
function _handleGamepad(msg) {
    const viewerId = msg.pad_id;
    if (!viewerId) return;

    const profileKey = viewerCtrlType.get(viewerId) || 'xbox360';
    const slotIndex = _allocateSlot(viewerId, profileKey);
    if (slotIndex < 0) return;

    if (!_bridge) return;

    _gpBuf[0] = 0x01;
    _gpBuf[1] = slotIndex;
    _gpBuf.writeUInt16LE(msg.buttons || 0, 2);
    _gpBuf[4] = Math.round((msg.lt || 0) * 255);
    _gpBuf[5] = Math.round((msg.rt || 0) * 255);
    _gpBuf.writeInt16LE(Math.round((msg.lx || 0) * 32767), 6);
    _gpBuf.writeInt16LE(Math.round((msg.ly || 0) * 32767), 8);
    _gpBuf.writeInt16LE(Math.round((msg.rx || 0) * 32767), 10);
    _gpBuf.writeInt16LE(Math.round((msg.ry || 0) * 32767), 12);

    _bridge.submitInputPacket(_gpBuf);
}

function _emitKbmBinding(padId, key, isDown, binds) {
    const isFlat = typeof Object.values(binds)[0] === 'string';
    const slotIdx = viewerSlots.get(padId);
    if (slotIdx === undefined) return;

    // Grab or initialize the persistent state for this KBM user
    let state = kbmStates.get(padId);
    if (!state) {
        state = { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, hx: 0, hy: 0, lt: 0, rt: 0 };
        kbmStates.set(padId, state);
    }

    if (isFlat) {
        const target = binds[key];
        if (!target) return;

        const aliasMap = { BTN_SOUTH: 'BTN_A', BTN_EAST: 'BTN_B', BTN_NORTH: 'BTN_X', BTN_WEST: 'BTN_Y' };
        const resolved = aliasMap[target] || target;

        if (resolved.startsWith('BTN_')) {
            const w3cBit = {
                BTN_A: W3C_BTN.A, BTN_B: W3C_BTN.B, BTN_X: W3C_BTN.X, BTN_Y: W3C_BTN.Y,
                BTN_TL: W3C_BTN.LB, BTN_TR: W3C_BTN.RB, BTN_SELECT: W3C_BTN.BACK, BTN_START: W3C_BTN.START,
                BTN_THUMBL: W3C_BTN.LS, BTN_THUMBR: W3C_BTN.RS, BTN_MODE: W3C_BTN.GUIDE,
            }[resolved];

            if (w3cBit !== undefined) {
                // Apply or remove the button bit WITHOUT erasing the other pressed buttons
                if (isDown) state.buttons |= w3cBit;
                else state.buttons &= ~w3cBit;
            }
        } else if (resolved.startsWith('ABS_')) {
            // Apply axis values
            if (resolved === 'ABS_Y_UP') state.ly = isDown ? -32767 : 0;
            if (resolved === 'ABS_Y_DOWN') state.ly = isDown ? 32767 : 0;
            if (resolved === 'ABS_X_LEFT') state.lx = isDown ? -32767 : 0;
            if (resolved === 'ABS_X_RIGHT') state.lx = isDown ? 32767 : 0;
        }
    } else {
        // Nested JSON logic
        const btnTarget = binds.buttons?.[key];
        if (btnTarget) {
            const w3cBit = { BTN_A: W3C_BTN.A, BTN_B: W3C_BTN.B, BTN_X: W3C_BTN.X, BTN_Y: W3C_BTN.Y }[btnTarget];
            if (w3cBit !== undefined) {
                if (isDown) state.buttons |= w3cBit;
                else state.buttons &= ~w3cBit;
            }
        }
        for (const section of ['left_stick', 'dpad']) {
            const m = binds[section]?.[key];
            if (m) {
                if (m.axis === 'ABS_X') state.lx = isDown ? m.val : 0;
                if (m.axis === 'ABS_Y') state.ly = isDown ? m.val : 0;
            }
        }
    }

    // Now send the FULL PERSISTENT STATE to the C++ module
    _gpBuf.fill(0, 1, 20);
    _gpBuf[0] = 0x01; // Gamepad Packet Type
    _gpBuf[15] = slotIdx;

    // Write buttons and sticks
    _gpBuf.writeUInt16LE(state.buttons, 11);
    _gpBuf.writeInt16LE(state.lx, 1);
    _gpBuf.writeInt16LE(state.ly, 3);
    _gpBuf.writeInt16LE(state.rx, 5);
    _gpBuf.writeInt16LE(state.ry, 7);

    _bridge.submitInputPacket(_gpBuf);
}

function _handleKbm(msg) {
    const viewerId = msg.pad_id || (msg.viewerId + '_0');
    if (!viewerId) return;

    const profileKey = viewerCtrlType.get(viewerId) || 'xbox360';
    const slotIndex = _allocateSlot(viewerId, profileKey);
    if (slotIndex < 0) return;

    let state = kbmStates.get(viewerId);
    if (!state) {
        state = { buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0, keys: {} };
        kbmStates.set(viewerId, state);
    }

    // --- THE FIX: Built-in default layout matching viewer.js 'KEY_' prefix ---
    const defaultKeys = {
        'KEY_W': 'LS_UP', 'KEY_A': 'LS_LEFT', 'KEY_S': 'LS_DOWN', 'KEY_D': 'LS_RIGHT',
        'KEY_SPACE': 'A', 'KEY_LEFTSHIFT': 'L3', 'KEY_LEFTCTRL': 'B', 'KEY_ESC': 'START', 'KEY_TAB': 'SELECT',
        'KEY_E': 'X', 'KEY_R': 'Y', 'KEY_F': 'LB', 'KEY_G': 'RB', 'KEY_C': 'R3',
        'KEY_UP': 'UP', 'KEY_DOWN': 'DOWN', 'KEY_LEFT': 'LEFT', 'KEY_RIGHT': 'RIGHT',
        'BTN_LEFT': 'RT', 'BTN_RIGHT': 'LT', 'BTN_MIDDLE': 'RB'
    };

    // Use KBM_BINDINGS if it loaded successfully, otherwise use the defaults
    const layout = (typeof KBM_BINDINGS !== 'undefined' && KBM_BINDINGS && KBM_BINDINGS.keys && Object.keys(KBM_BINDINGS.keys).length > 0)
    ? KBM_BINDINGS
    : { keys: defaultKeys, mouse: { sensitivity: 1.5, deadzone: 0.1 } };

    if (msg.event === 'keydown' || msg.event === 'keyup') {
        // Try the loaded layout first, fallback to the hardcoded default
        const action = layout.keys[msg.key] || defaultKeys[msg.key];
        if (!action) return;

        const isDown = (msg.event === 'keydown');
        state.keys[action] = isDown;

        if (KBM_BTN_MAP[action]) {
            if (isDown) state.buttons |= KBM_BTN_MAP[action];
            else state.buttons &= ~KBM_BTN_MAP[action];
        } else if (action === 'LT') {
            state.lt = isDown ? 1.0 : 0.0;
        } else if (action === 'RT') {
            state.rt = isDown ? 1.0 : 0.0;
        } else if (action.startsWith('LS_')) {
            state.lx = (state.keys['LS_RIGHT'] ? 1.0 : 0) - (state.keys['LS_LEFT'] ? 1.0 : 0);
            state.ly = (state.keys['LS_DOWN'] ? 1.0 : 0) - (state.keys['LS_UP'] ? 1.0 : 0);
        }
    }
    else if (msg.event === 'mousemove') {
        const sens = layout.mouse?.sensitivity || 1.5;
        const deadzone = layout.mouse?.deadzone || 0.1;

        let dx = (msg.dx / 100.0) * sens;
        let dy = (msg.dy / 100.0) * sens;

        dx = Math.max(-1.0, Math.min(1.0, dx));
        dy = Math.max(-1.0, Math.min(1.0, dy));

        if (Math.abs(dx) < deadzone) dx = 0;
        if (Math.abs(dy) < deadzone) dy = 0;

        state.rx = dx;
        state.ry = dy;

        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = setTimeout(() => {
            state.rx = 0;
            state.ry = 0;
            if (typeof _sendKbmStateToBuffer === 'function') _sendKbmStateToBuffer(slotIndex, state);
        }, 50);
    }

    if (typeof _sendKbmStateToBuffer === 'function') {
        _sendKbmStateToBuffer(slotIndex, state);
    }
}

// Ensure this helper function exists right below _handleKbm
function _sendKbmStateToBuffer(slotIndex, state) {
    if (!_bridge) return;
    _gpBuf[0] = 0x01; // Gamepad Packet
    _gpBuf[1] = slotIndex;
    _gpBuf.writeUInt16LE(state.buttons, 2);
    _gpBuf[4] = Math.round(state.lt * 255);
    _gpBuf[5] = Math.round(state.rt * 255);
    _gpBuf.writeInt16LE(Math.round(state.lx * 32767), 6);
    _gpBuf.writeInt16LE(Math.round(state.ly * 32767), 8);
    _gpBuf.writeInt16LE(Math.round(state.rx * 32767), 10);
    _gpBuf.writeInt16LE(Math.round(state.ry * 32767), 12);
    _bridge.submitInputPacket(_gpBuf);
}

// ── Dispatcher & Exports ───────────────────────────────────────────────────────
function send(msg) {
    // Fallback passthrough to Python if Native module failed
    if (!_bridge && _pythonProc && _pythonProc.stdin.writable) {
        try { _pythonProc.stdin.write(JSON.stringify(msg) + '\n'); } catch (e) {}
        return;
    }

    if (msg.type === 'gamepad') {
        _handleGamepad(msg);
    } else if (msg.type === 'kbm' || msg.type === 'keyboard') {
        _handleKbm(msg);
    } else if (msg.type === 'set-ctrl-type') {
        viewerCtrlType.set(msg.viewerId, msg.ctrlType);
    } else if (msg.type === 'set-input-mode') {
        viewerModes.set(msg.viewerId, msg.mode);
    } else if (msg.type === 'disconnect_viewer') {
        _freeSlot(msg.viewer_id);
    } else if (msg.type === 'flush_neutral') {
        const slot = viewerSlots.get(msg.viewer_id);
        if (slot !== undefined && _bridge) {
            _flBuf[1] = slot;
            _bridge.submitInputPacket(_flBuf);
        }
    } else if (msg.type === 'destroy_all') {
        destroy();
    }
}

function destroy() {
    for (const vid of viewerSlots.keys()) {
        _freeSlot(vid);
    }
    if (_bridge && _bridge.destroy) {
        _bridge.destroy();
    }
    if (_pythonProc) {
        if (_pythonProc.stdin?.writable) {
            _pythonProc.stdin.write(JSON.stringify({ type: 'destroy_all' }) + '\n');
        }
        _pythonProc.kill();
        _pythonProc = null;
    }
    console.log("[input] Orchestrator destroyed.");
}

module.exports = { init, send, destroy };
