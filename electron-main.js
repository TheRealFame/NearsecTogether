'use strict';

process.on('uncaughtException', (e) => console.error('\n[electron] ⚠ Uncaught Exception:', e));
process.on('unhandledRejection', (e) => console.error('\n[electron] ⚠ Unhandled Rejection:', e));

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, powerSaveBlocker } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const https  = require('https');
const sudo   = require('sudo-prompt'); // Required for GUI password prompts

// Prevent computer from sleeping while hosting
powerSaveBlocker.start('prevent-app-suspension');

const ROOT         = path.join(__dirname);
const PAGES_DIR    = path.join(ROOT, 'src', 'pages');
const ASSETS_DIR   = path.join(ROOT, 'assets');
const PRELOAD_MAIN = path.join(ROOT, 'electron-preload.js');
const PRELOAD_VIEW = path.join(ROOT, 'electron-viewer-preload.js');
const CONFIG_FILE  = path.join(app.getPath('userData'), 'nearsectogether.config.json');

// ── Config helpers ────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch { return {}; }
}
function saveConfig(patch) {
  try {
    const cfg = { ...loadConfig(), ...patch };
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    return cfg;
  } catch { return {}; }
}

const initialCfg = loadConfig();

// ── Chromium flags ────────────────────────────────────────────────────────────
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-gamepad-button-axis-events');

if (initialCfg.hwDecode !== false) {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');
}
if (initialCfg.fpsUnlock) app.commandLine.appendSwitch('disable-frame-rate-limit');
if (initialCfg.vsyncOff)  app.commandLine.appendSwitch('disable-gpu-vsync');
if (initialCfg.zeroCopy) {
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
} else {
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// ── System Readiness Check ────────────────────────────────────────────────────
function checkSystemReady() {
  if (process.platform === 'linux') {
    try {
      // Check if the virtual controller device is writable
      fs.accessSync('/dev/uinput', fs.constants.W_OK);
      return true;
    } catch (err) {
      return false; // User needs to run linux_setup.sh
    }
  }
  if (process.platform === 'win32') {
    // Check if ViGEmBus is installed
    const vigemPath = 'C:\\Program Files\\Nefarius Software Solutions\\ViGEm Bus Driver';
    return fs.existsSync(vigemPath);
  }
  return true; // Mac/Other
}

const { exec } = require('child_process');

ipcMain.on('run-setup', (event) => {
  const resourceFolder = app.isPackaged ? process.resourcesPath : ROOT;

  if (process.platform === 'win32') {
    const scriptPath = path.join(resourceFolder, 'bin', 'windows_setup.ps1');

    // Windows: This opens a brand new, VISIBLE PowerShell window as Administrator.
    // -Wait ensures Electron pauses until the user finishes and closes the terminal window.
    const cmd = `powershell.exe -Command "Start-Process powershell -ArgumentList '-NoExit -ExecutionPolicy Bypass -File \\"${scriptPath}\\"' -Verb RunAs -Wait"`;

    exec(cmd, (error) => {
      if (error) {
        console.error('[setup]', error);
        return event.sender.send('setup-failed', 'Setup was cancelled or failed.');
      }
      event.sender.send('setup-success');
      app.relaunch();
      app.quit();
    });

  } else if (process.platform === 'darwin') {
    // Mac: Opens the native macOS Terminal app and runs the pip3 install
    const cmd = `osascript -e 'tell application "Terminal" to do script "echo \\"Running Nearsec Mac Setup...\\"; pip3 install pyautogui; echo \\"Done. You can close this window.\\""'`;

    exec(cmd, (error) => {
      if (error) return event.sender.send('setup-failed', error.message);
      event.sender.send('setup-success');
      app.relaunch();
      app.quit();
    });

  } else if (process.platform === 'linux') {
    // Linux: sudo-prompt is still safe here because your .sh script has no "pause" commands
    const sudo = require('sudo-prompt');
    const scriptPath = path.join(resourceFolder, 'linux_setup.sh');

    sudo.exec(`bash "${scriptPath}"`, { name: 'NearsecTogether' }, (error, stdout) => {
      if (error) return event.sender.send('setup-failed', error.message || 'Permission denied.');
      event.sender.send('setup-success');
      app.relaunch();
      app.quit();
    });
  }
});

// ── Server process management ─────────────────────────────────────────────────
let serverPort = null;
let serverCore = null;

function startServer() {
  return new Promise((resolve) => {
    if (serverPort) return resolve(serverPort);

    const origLog = console.log;
    process.env.ELECTRON_MODE = '1';
    serverCore = require(path.join(ROOT, 'src', 'scripts', 'server.js'));

    const _log = console.log.bind(console);
    console.log = function (...args) {
      _log(...args);
      const s = args.join(' ');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('server-log', s.trim());
      const m = s.match(/Listening on port (\d+)/);
      if (m && !serverPort) {
        serverPort = parseInt(m[1]);
        console.log = origLog;
        resolve(serverPort);
      }
    };
    setTimeout(() => { if (!serverPort) { serverPort = 3000; resolve(3000); } }, 6000);
  });
}

function stopServer() {
  if (serverCore && serverCore.cleanup) serverCore.cleanup(true);
}

// ── Discord RPC ───────────────────────────────────────────────────────────────
const DISCORD_CLIENT_ID = '1234567890000000000';
let discordRPC = null, discordReady = false, discordActivity = null;

async function initDiscord() {
  try {
    const DiscordRPC = require('discord-rpc');
    DiscordRPC.register(DISCORD_CLIENT_ID);
    discordRPC = new DiscordRPC.Client({ transport: 'ipc' });

    discordRPC.on('ready', () => {
      discordReady = true;
      setDiscordActivity(discordActivity || { details: 'Browsing Nearsec Arcade', state: 'Choosing a session', largeImageKey: 'nearsec_logo', largeImageText: 'NearsecTogether', instance: false });
    });
    discordRPC.on('disconnected', () => { discordReady = false; });
    await discordRPC.login({ clientId: DISCORD_CLIENT_ID }).catch(() => { discordRPC = null; });
  } catch (e) { discordRPC = null; }
}

function setDiscordActivity(activity) {
  discordActivity = activity;
  if (!discordRPC || !discordReady) return;
  try { discordRPC.setActivity({ ...activity, startTimestamp: Date.now() }); } catch {}
}
function clearDiscordActivity() {
  if (!discordRPC || !discordReady) return;
  try { discordRPC.clearActivity(); } catch {}
}

// ── Window management ─────────────────────────────────────────────────────────
let mainWindow = null, viewerWindow = null, tray = null;
const IS_STEAM_DECK = process.env.SteamDeck === '1' || fs.existsSync('/etc/steamos-release') || (process.platform === 'linux' && !!process.env.STEAM_COMPAT_DATA_PATH);

function createSetupWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 600, height: 500,
    backgroundColor: '#080808',
    icon: path.join(ASSETS_DIR, 'NearsecTogether.png'),
                                 webPreferences: { preload: PRELOAD_MAIN, nodeIntegration: false, contextIsolation: true }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(PAGES_DIR, 'setup.html'));
}

function createMainWindow(port) {
  Menu.setApplicationMenu(null);
  const winState = loadConfig().mainWindowState || {};

  mainWindow = new BrowserWindow({
    width: winState.width || 1280, height: winState.height || 800, x: winState.x, y: winState.y,
    minWidth: 900, minHeight: 600, backgroundColor: '#080808', show: false,
    icon: path.join(ASSETS_DIR, 'NearsecTogether.png'),
                                 titleBarStyle: 'hidden', titleBarOverlay: { color: '#080808', symbolColor: '#c084fc', height: 36 },
                                 webPreferences: { preload: PRELOAD_MAIN, nodeIntegration: false, contextIsolation: true, webSecurity: true },
  });

  mainWindow.setMenuBarVisibility(false);
  ['resize', 'move'].forEach(ev => {
    mainWindow.on(ev, () => {
      if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
      saveConfig({ mainWindowState: mainWindow.getBounds() });
    });
  });

  if (loadConfig().bootToHost) {
    mainWindow.loadURL(`http://localhost:${port}/host`);
  } else {
    mainWindow.loadFile(path.join(PAGES_DIR, 'dashboard.html'), { query: { port: String(port) } });
  }

  // Inject hidden dashboard slider into Host
  mainWindow.webContents.on('did-finish-load', () => {
    const currentURL = mainWindow.webContents.getURL();
    if (currentURL.includes('/host')) {
      mainWindow.webContents.executeJavaScript(`
      if (!document.getElementById('ns-dash-trigger') && window.electronAPI) {
        const trigger = document.createElement('div');
        trigger.id = 'ns-dash-trigger';
        trigger.style.cssText = 'position:fixed;bottom:0;left:0;width:60px;height:80px;z-index:999998;';
        const btn = document.createElement('button');
        btn.id = 'ns-dash-btn';
        btn.innerHTML = '← Dashboard';
        btn.style.cssText = 'position:fixed;bottom:20px;left:-40px;opacity:0;z-index:999999;padding:12px 20px;background:#141414;color:#c084fc;border:1px solid #c084fc;border-left:none;border-radius:0 8px 8px 0;font-family:monospace;font-weight:bold;cursor:pointer;box-shadow:4px 4px 20px rgba(0,0,0,0.8);transition:all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);pointer-events:none;';

        trigger.onmouseenter = () => { btn.style.opacity = '1'; btn.style.left = '0'; btn.style.pointerEvents = 'auto'; };
        trigger.onmouseleave = (e) => { if (e.relatedTarget === btn) return; btn.style.opacity = '0'; btn.style.left = '-40px'; btn.style.pointerEvents = 'none'; btn.style.background = '#141414'; btn.style.color = '#c084fc'; };
        btn.onmouseleave = (e) => { if (e.relatedTarget === trigger) return; btn.style.opacity = '0'; btn.style.left = '-40px'; btn.style.pointerEvents = 'none'; btn.style.background = '#141414'; btn.style.color = '#c084fc'; };
        btn.onmouseover = () => { btn.style.background = '#c084fc'; btn.style.color = '#000'; };
        btn.onclick = () => window.electronAPI.backToDashboard();

        document.body.appendChild(trigger);
        document.body.appendChild(btn);
      }
      `);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_STEAM_DECK) mainWindow.maximize();
  });

    mainWindow.on('close', (e) => {
      if (loadConfig().tray !== false && tray && !app.isQuiting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    if (loadConfig().alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'floating');
    return mainWindow;
}

function createViewerWindow(sessionUrl, meta = {}) {
  if (viewerWindow && !viewerWindow.isDestroyed()) { viewerWindow.loadURL(sessionUrl); viewerWindow.focus(); return viewerWindow; }

  viewerWindow = new BrowserWindow({
    width: 1280, height: 800, fullscreen: IS_STEAM_DECK, backgroundColor: '#000000',
    icon: path.join(ASSETS_DIR, 'NearsecTogether.png'), frame: false,
                                   webPreferences: { preload: PRELOAD_VIEW, nodeIntegration: false, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, enablePreferredSizeMode: true },
  });

  viewerWindow.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'pointerLock', 'fullscreen', 'gamepad', 'notifications'].includes(permission)));
  viewerWindow.loadURL(sessionUrl);
  viewerWindow.webContents.on('did-finish-load', () => {
    viewerWindow.webContents.executeJavaScript(`
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    const _rpl = HTMLElement.prototype.requestPointerLock;
    HTMLElement.prototype.requestPointerLock = function() {
      try { return _rpl.call(this); } catch(e) {
        document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return _rpl.call(this);
      }
    };
    window.__NEARSEC_ELECTRON__ = true;
    window.__NEARSEC_STEAM_DECK__ = ${IS_STEAM_DECK};
    `);
  });

  setDiscordActivity({ details: meta.game ? 'Playing ' + meta.game : 'In a session', state: 'On Nearsec Arcade', largeImageKey: 'nearsec_logo', largeImageText: 'NearsecTogether', instance: false });
  viewerWindow.on('closed', () => {
    viewerWindow = null;
    setDiscordActivity({ details: 'Browsing Nearsec Arcade', state: 'Choosing a session', largeImageKey: 'nearsec_logo', largeImageText: 'NearsecTogether', instance: false });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
    return viewerWindow;
}

function pingSessionUrl(rawUrl) {
  return new Promise((resolve) => {
    try {
      const infoUrl = new URL('/api/info', rawUrl);
      const mod = infoUrl.protocol === 'https:' ? https : http;
      const req = mod.get(infoUrl.toString(), { timeout: 6000 }, (res) => {
        let data = ''; res.on('data', d => data += d);
        res.on('end', () => { try { resolve({ ok: true, info: JSON.parse(data) }); } catch { resolve({ ok: false, reason: 'Invalid response' }); }});
      });
      req.on('error', () => resolve({ ok: false, reason: 'Unreachable' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'Timeout' }); });
    } catch (e) { resolve({ ok: false, reason: e.message }); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS_DIR, 'NearsecTogether.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('NearsecTogether');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
                                             { type: 'separator' },
                                             { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('join-session', async (_e, { url, meta }) => {
  const check = await pingSessionUrl(url);
  if (!check.ok) return { error: check.reason || 'Session unreachable' };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  createViewerWindow(url + (url.includes('?') ? '&' : '?') + '__electron=1', meta || {});
  return { ok: true };
});

ipcMain.on('open-host', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`http://localhost:${serverPort}/host`);
  }
});

ipcMain.on('back-to-dashboard-from-host', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(PAGES_DIR, 'dashboard.html'), { query: { port: String(serverPort) } });
  }
});

ipcMain.on('back-to-dashboard', () => {
  if (viewerWindow && !viewerWindow.isDestroyed()) viewerWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('viewer-closed'); }
});

ipcMain.handle('get-settings', () => loadConfig());
ipcMain.handle('save-settings', (_, s) => saveConfig(s));
ipcMain.on('toggle-always-on-top', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, 'floating');
  saveConfig({ alwaysOnTop: next });
});

ipcMain.on('discord-set-activity', (_e, activity) => setDiscordActivity(activity));
ipcMain.on('discord-clear', () => clearDiscordActivity());

ipcMain.on('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
ipcMain.on('window-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

ipcMain.handle('get-server-info', async () => {
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${serverPort}/api/info`, { timeout: 3000 }, (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(); } });
      }).on('error', reject);
    });
    return { ok: true, ...res, port: serverPort };
  } catch { return { ok: false, port: serverPort }; }
});

ipcMain.handle('ping-session', async (_e, url) => pingSessionUrl(url));

// ── App Lifecycle ─────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

  app.on('ready', async () => {
    // 1. Check if the OS is properly configured
    if (!checkSystemReady()) {
      createSetupWindow();
      return;
    }

    // 2. If configured, boot normally
    const port = await startServer();
    serverPort = port;
    createMainWindow(port);
    if (loadConfig().tray !== false) createTray();
    if (loadConfig().discordRPC !== false) initDiscord().catch(() => {});

    let isPanicActive = false;
    globalShortcut.register('CommandOrControl+Shift+Backspace', () => {
      isPanicActive = !isPanicActive;
      console.log(`\n[electron] PANIC MODE ${isPanicActive ? 'ACTIVATED (Inputs Frozen)' : 'DEACTIVATED (Inputs Resumed)'}`);
      if (serverCore && serverCore.toUinput) {
        serverCore.toUinput({ type: 'panic_toggle', enabled: isPanicActive });
      }
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(serverPort); else mainWindow.show(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopServer(); if (discordRPC) try { discordRPC.destroy(); } catch {} });
}
