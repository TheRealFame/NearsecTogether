const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { powerSaveBlocker } = require('electron');
powerSaveBlocker.start('prevent-app-suspension');

// ── Global Error Handlers (Prevents silent crashes) ───────────────────────────
process.on('uncaughtException', (error) => {
  console.error('\n[electron] ⚠ Uncaught Exception:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('\n[electron] ⚠ Unhandled Rejection:', error);
});

// ── Platform Detection & Startup Warnings ─────────────────────────────────────
if (process.platform === 'win32') {
  console.log('\n' + '='.repeat(60));
  console.log('  ⚠ WINDOWS - EXPERIMENTAL MODE');
  console.log('='.repeat(60));
  console.log('  Gamepad Support: Requires ViGEmBus driver');
  console.log('  URL: https://github.com/nefarius/ViGEmBus/releases');
  console.log('  KBM Input: Supported (keyboard/mouse)');
  console.log('  Audio: Using Windows Media Player');
  console.log('='.repeat(60) + '\n');
} else if (process.platform === 'darwin') {
  console.log('\n' + '='.repeat(60));
  console.log('  ⚠ macOS - EXPERIMENTAL MODE');
  console.log('='.repeat(60));
  console.log('  Gamepad Support: NOT available (no injection API)');
  console.log('  KBM Input: Supported (keyboard/mouse via pyautogui)');
  console.log('  Install: pip3 install pyautogui');
  console.log('='.repeat(60) + '\n');
} else if (process.platform === 'linux') {
  console.log('[electron] Linux - Fully supported');
}

if (process.platform === 'darwin') {
  app.dock.setIcon(path.join(__dirname, 'assets/NearsecTogether.png'));
}

// ── Wayland / GPU flags ───────────────────────────────────────────────────────
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoEncoder,VaapiVideoDecoder,PlatformHEVCDecoderSupport,WebRTCPipeWireCapturer');
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
    if (fs.existsSync(CONFIG_FILE)) return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
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
let serverPort = null;
let serverCore = null; // Store reference to server.js so we can call its cleanup

function startServer() {
  return new Promise((resolve) => {
    const origLog = console.log;
    process.env.ELECTRON_MODE = '1';

    serverCore = require('./src/scripts/server.js'); // Hook the server logic

    const _log = console.log.bind(console);
    console.log = function (...args) {
      _log(...args);
      const s = args.join(' ');
      const m = s.match(/Listening on port (\d+)/);
      if (m && !serverPort) {
        serverPort = parseInt(m[1]);
        console.log = _log;
        resolve(serverPort);
      }
    };
    setTimeout(() => { if (!serverPort) { serverPort = 3000; resolve(3000); } }, 6000);
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
                          minWidth: 650,
                          minHeight: 500,
                          title: 'NearsecTogether',
                          icon: path.join(__dirname, 'assets/NearsecTogether.png'),
                          backgroundColor: '#111111',
                          alwaysOnTop: settings.alwaysOnTop,
                          show: false,
                          webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true,
                            preload: path.join(__dirname, 'electron-preload.js'),
                          },
                          autoHideMenuBar: true,
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL('http://localhost:' + port + '/host');

  win.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[electron] failed to load:', code, desc);
    setTimeout(() => win.loadURL('http://localhost:' + port + '/host'), 1000);
  });

  const { desktopCapturer } = require('electron');
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      if (sources && sources.length > 0) {
        // 'loopback' captures system audio on Windows only.
        // On Linux, audio is handled by the browser-side PipeWire getDisplayMedia.
        // We must omit the 'audio' key entirely if we aren't using loopback.
        if (process.platform === 'win32') {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({ video: sources[0] });
        }
      } else {
        callback({});
      }
    }).catch(err => {
      console.error('[electron] desktopCapturer error:', err);
      // Only call the fallback if the callback hasn't already been consumed
      try { callback({}); } catch (e) { /* ignore double-call errors */ }
    });
  });

  // ── Minimize to tray vs Quit Dialog ──────────────────────────────────────────
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets/NearsecTogether.png')).resize({ width: 22, height: 22 });
  tray = new Tray(trayIcon);
  tray.setToolTip('NearsecTogether');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
                                             { type: 'separator' },
                                             { label: 'Quit NearsecTogether', click: () => { app.isQuiting = true; app.quit(); } },
  ]));

  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });

  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault(); // Stop immediate closure

      // Prompt user with a clean native dialog
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Minimize to Tray', 'Quit App', 'Cancel'],
        defaultId: 0,
          cancelId: 2,
          title: 'Closing NearsecTogether',
          message: 'Do you want to minimize to the system tray or quit completely?',
          detail: 'Quitting will disconnect all viewers and shut down your virtual controllers.'
      });

      if (choice === 0) {
        win.hide();
        if (tray.displayBalloon) tray.displayBalloon({ title: 'NearsecTogether', content: 'Running in the background.' });
      } else if (choice === 1) {
        app.isQuiting = true;
        app.quit();
      }
      // If choice === 2 (Cancel), do nothing
    }
  });

  try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
  } catch (e) {
    if (e.code !== 'EACCES') console.warn('[electron] Could not set high priority:', e.message);
  }

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  const { globalShortcut } = require('electron');
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.webContents.on('media-started-playing', () => { win.focus(); win.webContents.focus(); });

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

  // ── Source picker (Discord-style grid — all windows at once) ──────────────
  ipcMain.handle('get-window-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      return sources.map(s => ({
        id:        s.id,
        name:      s.name,
        thumbnail: s.thumbnail.toDataURL(),
                               isScreen:  s.id.startsWith('screen:'),
      }));
    } catch (err) {
      console.error('[electron] get-window-sources error:', err.message);
      return [];
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  const { globalShortcut } = require('electron');
  let isPanicActive = false;

  // ── THE PANIC BUTTON: Ctrl + Shift + Backspace ──
  // This listens globally. Even if the app is minimized or your mouse is hijacked,
  // hitting this combo will instantly freeze or unfreeze viewer inputs.
  globalShortcut.register('CommandOrControl+Shift+Backspace', () => {
    isPanicActive = !isPanicActive;
    console.log(`\n[electron] PANIC MODE ${isPanicActive ? 'ACTIVATED (Inputs Frozen)' : 'DEACTIVATED (Inputs Resumed)'}`);

    // Send the toggle directly to the Python uinput sidecar
    if (serverCore && serverCore.toUinput) {
      serverCore.toUinput({ type: 'panic_toggle', enabled: isPanicActive });
    }
  });
});

// ── Cleanup Hook ──────────────────────────────────────────────────────────────
app.on('will-quit', () => {
  console.log("\n[electron] App is quitting, forcing cleanup...");
  const { globalShortcut } = require('electron');
  globalShortcut.unregisterAll(); // Free up the hotkey when closing

  if (serverCore && serverCore.cleanup) {
    serverCore.cleanup(true);
  }
});

app.on('window-all-closed', () => app.quit());
