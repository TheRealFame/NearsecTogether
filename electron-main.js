const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { powerSaveBlocker } = require('electron');
powerSaveBlocker.start('prevent-app-suspension');


if (process.platform === 'darwin') {
  app.dock.setIcon(path.join(__dirname, 'assets/NearsecTogether.png'));
}

// ── Wayland / GPU flags ───────────────────────────────────────────────────────
// Must be set before app is ready
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features',
  'VaapiVideoEncoder,VaapiVideoDecoder,PlatformHEVCDecoderSupport,WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-frame-rate-limit');

app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// ── Settings ──────────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(app.getPath('userData'), 'NearsecTogether');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');
const DEFAULTS = { encoder: 'gpu', codec: 'h264', preset: 'fast', alwaysOnTop: false, w: 1280, h: 800 };

function loadSettings() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (fs.existsSync(CONFIG_FILE))
      return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch { }
  return Object.assign({}, DEFAULTS);
}
function saveSettings(s) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(s, null, 2));
  } catch (e) { console.error('saveSettings:', e.message); }
}
let settings = loadSettings();

// ── Start server in-process ───────────────────────────────────────────────────
// Run server.js logic directly — no fork, no timing issues
let serverPort = null;

function startServer() {
  return new Promise((resolve) => {
    // Patch console.log to intercept port announcement
    const origLog = console.log;
    // Override openBrowser since Electron handles the window
    process.env.ELECTRON_MODE = '1';
    require('./src/scripts/server.js');
    // server.js calls console.log("Listening on port N")
    // We hook it briefly to grab the port
    const _log = console.log.bind(console);
    console.log = function (...args) {
      _log(...args);
      const s = args.join(' ');
      const m = s.match(/Listening on port (\d+)/);
      if (m && !serverPort) {
        serverPort = parseInt(m[1]);
        console.log = _log; // restore
        resolve(serverPort);
      }
    };
    // Fallback — if port line already fired before we hooked
    setTimeout(() => {
      if (!serverPort) { serverPort = 3000; resolve(3000); }
    }, 6000);
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
let win = null;
let tray = null;

async function createWindow() {
  const port = await startServer();
  console.log('[electron] server ready on port', port);

  win = new BrowserWindow({
    width: Math.max(settings.w, 600),
    height: Math.max(settings.h, 500),
    minWidth: 600,
    minHeight: 500,
    title: 'NearsecTogether',
    icon: path.join(__dirname, 'assets/NearsecTogether.png'),
    backgroundColor: '#111111',
    alwaysOnTop: settings.alwaysOnTop,
    show: false, // don't show until content loads
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
    autoHideMenuBar: true,
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.loadURL('http://localhost:' + port + '/host');

  win.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[electron] failed to load:', code, desc);
    setTimeout(() => win.loadURL('http://localhost:' + port + '/host'), 1000);
  });

  // getDisplayMedia in Electron requires this handler.
  // We pass the desktopCapturer source directly — no system picker string.
  const { desktopCapturer } = require('electron');
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      if (sources && sources.length > 0) {
        // Try to find PipeWire audio source first (preferred on Linux)
        // Otherwise use 'loopback' or system default audio
        let audioSource = sources.find(s => s.name && s.name.toLowerCase().includes('pipewire'));
        let audioConfig = audioSource ? { id: audioSource.id } : 'loopback';
        callback({ video: sources[0], audio: audioConfig });
      } else {
        console.error('[electron] No screen sources found. Wayland Portal may be failing.');
        callback({});
      }
    }).catch(err => {
      console.error('[electron] desktopCapturer error:', err);
      callback({});
    });
  });

  win.on('resize', () => {
    const [w, h] = win.getSize();
    settings.w = w; settings.h = h;
    saveSettings(settings);
  });

  win.on('closed', () => { win = null; });

  // ── Minimize to tray instead of quitting ─────────────────────────────────────
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets/NearsecTogether.png')).resize({ width: 22, height: 22 });
  tray = new Tray(trayIcon);
  tray.setToolTip('NearsecTogether');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });

  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
      tray.displayBalloon && tray.displayBalloon({ title: 'NearsecTogether', content: 'Still running in tray.' });
    }
  });

  // ── Raise process priority for smoother streaming ────────────────────────────
  try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
  } catch (e) {
    console.warn('[electron] Could not set high priority:', e.message);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' };
  });

  // Devtools shortcut — Ctrl+Shift+I or F12
  const { globalShortcut } = require('electron');
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Refocus window after display media picker closes
  // The OS picker steals focus and doesn't always return it
  win.webContents.on('media-started-playing', () => {
    win.focus();
    win.webContents.focus();
  });

  // IPC handlers
  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('save-settings', (_, s) => {
    settings = Object.assign(settings, s); saveSettings(settings);
    if (win) win.webContents.send('settings-updated', settings);
    return settings;
  });
  ipcMain.handle('toggle-always-on-top', () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    if (win) win.setAlwaysOnTop(settings.alwaysOnTop);
    saveSettings(settings);
    return settings.alwaysOnTop;
  });
}

app.whenReady().then(createWindow);
app.on('before-quit', () => { app.isQuiting = true; });
app.on('window-all-closed', () => app.quit());
