// Murcord — proceso principal (ventana, pestañas, perfiles y Equicord)
const {
  app, BrowserWindow, WebContentsView, Menu, ipcMain, dialog, session, shell, net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

const MAX_TABS = 10;
const TABBAR_HEIGHT = 44;
const DISCORD_URL = 'https://discord.com/app';
const MAIN_PROFILE_ID = 'main';

app.setName('Murcord');
app.setPath('userData', path.join(app.getPath('appData'), 'Murcord'));
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let win = null;
let config = null;
let userAgent = '';
let equicord = { js: null, css: null };
const views = new Map();  // tabId -> WebContentsView (se crean al activar la pestaña)
const titles = new Map(); // tabId -> título de la página

/* ---------- Configuración (pestañas y perfiles) ---------- */

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

function loadConfig() {
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) { /* primera vez o archivo dañado */ }
  if (!cfg || typeof cfg !== 'object') cfg = {};

  cfg.profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
  cfg.tabs = Array.isArray(cfg.tabs) ? cfg.tabs : [];

  // El perfil principal siempre existe.
  if (!cfg.profiles.some((p) => p.id === MAIN_PROFILE_ID)) {
    cfg.profiles.unshift({ id: MAIN_PROFILE_ID, name: 'Principal' });
  }

  // Nombres antiguos "Cuenta N" pasan a "Pestaña N".
  for (const p of cfg.profiles) {
    const m = /^Cuenta (\d+)$/.exec(p.name || '');
    if (m) p.name = `Pestaña ${m[1]}`;
  }

  // Quita pestañas con perfil inexistente o repetido (1 pestaña por perfil).
  const seen = new Set();
  cfg.tabs = cfg.tabs.filter((t) => {
    const exists = cfg.profiles.some((p) => p.id === t.profileId);
    if (!exists || seen.has(t.profileId)) return false;
    seen.add(t.profileId);
    return true;
  });

  // La pestaña 0 es siempre la principal.
  const mainTab = cfg.tabs.find((t) => t.profileId === MAIN_PROFILE_ID)
    || { id: newId(), profileId: MAIN_PROFILE_ID };
  cfg.tabs = [mainTab, ...cfg.tabs.filter((t) => t !== mainTab)].slice(0, MAX_TABS);

  if (!cfg.tabs.some((t) => t.id === cfg.activeTabId)) cfg.activeTabId = mainTab.id;
  cfg.nextProfileNumber = cfg.nextProfileNumber || 2;
  return cfg;
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('No se pudo guardar config.json:', err);
  }
}

/* ---------- Estado que se envía a la barra de pestañas ---------- */

function buildState() {
  return {
    max: MAX_TABS,
    activeTabId: config.activeTabId,
    tabs: config.tabs.map((t, i) => {
      const profile = config.profiles.find((p) => p.id === t.profileId);
      return {
        id: t.id,
        label: profile ? profile.name : '?',
        title: titles.get(t.id) || '',
        main: i === 0,
        closable: i > 0,
      };
    }),
  };
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', buildState());
}

/* ---------- Equicord (build web de tu fork) ---------- */

// Busca la carpeta dist donde está Equicord.user.js.
function findEquicordDir() {
  const candidates = [
    process.env.MURCORD_EQUICORD_DIR,                    // opcional: ruta propia
    path.join(process.resourcesPath || '', 'equicord'),  // app empaquetada
    path.join(os.homedir(), 'Murcord', 'dist'),          // tu clon en desarrollo
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'Equicord.user.js'))) || null;
}

function loadEquicordBundle() {
  const dir = findEquicordDir();
  if (!dir) {
    console.error('[Murcord] No se encontró Equicord.user.js. Ejecuta pnpm buildWeb en el clon.');
    return { js: null, css: null };
  }
  const read = (name) => {
    try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch (_) { return null; }
  };
  console.log('[Murcord] Equicord cargado desde', dir);
  return { js: read('Equicord.user.js'), css: read('Equicord.user.css') };
}

// Solo aceptamos mensajes que vengan de una página de discord.com.
function isDiscordSender(e) {
  try {
    const host = new URL(e.senderFrame.url).hostname;
    return host === 'discord.com' || host.endsWith('.discord.com');
  } catch (_) {
    return false;
  }
}

// Prepara la sesión de un perfil: user agent y sin CSP (Equicord lo necesita, igual que en el escritorio).
const preparedPartitions = new Set();
function prepareSession(partition) {
  if (preparedPartitions.has(partition)) return;
  preparedPartitions.add(partition);

  const ses = session.fromPartition(partition);
  ses.setUserAgent(userAgent);
  ses.webRequest.onHeadersReceived(
    { urls: ['*://discord.com/*', '*://*.discord.com/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
          delete headers[name];
        }
      }
      callback({ responseHeaders: headers });
    },
  );
}

/* ---------- Vistas (una por pestaña, con sesión aislada por perfil) ---------- */

function ensureView(tab) {
  let view = views.get(tab.id);
  if (view) return view;

  const partition = `persist:murcord-${tab.profileId}`; // "persist:" = se guarda en disco
  prepareSession(partition);

  view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/tab.js'), // inyecta Equicord
    },
  });
  view.setVisible(false);
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('page-title-updated', (_e, title) => {
    titles.set(tab.id, title);
    pushState();
  });
  wc.on('before-input-event', handleShortcut);
  wc.loadURL(DISCORD_URL);

  views.set(tab.id, view);
  return view;
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  for (const [tabId, view] of views) {
    const isActive = tabId === config.activeTabId;
    view.setVisible(isActive);
    if (isActive) {
      view.setBounds({
        x: 0,
        y: TABBAR_HEIGHT,
        width,
        height: Math.max(0, height - TABBAR_HEIGHT),
      });
    }
  }
}

/* ---------- Lógica de pestañas ---------- */

function notifyLimit() {
  dialog.showMessageBox(win, {
    type: 'info',
    message: `Máximo ${MAX_TABS} pestañas abiertas`,
    detail: 'Cierra una pestaña para abrir otra. Tus cuentas siguen guardadas.',
  });
}

function activateTab(tabId) {
  const tab = config.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  config.activeTabId = tab.id;
  const view = ensureView(tab);
  layout();
  view.webContents.focus();
  saveConfig();
  pushState();
}

// Abre el perfil en una pestaña; si ya está abierto, solo cambia a esa pestaña.
function openProfile(profileId) {
  const existing = config.tabs.find((t) => t.profileId === profileId);
  if (existing) return activateTab(existing.id);
  if (config.tabs.length >= MAX_TABS) return notifyLimit();

  const tab = { id: newId(), profileId };
  config.tabs.push(tab);
  return activateTab(tab.id);
}

function createProfile() {
  if (config.tabs.length >= MAX_TABS) return notifyLimit();
  const n = config.nextProfileNumber++;
  const profile = { id: newId(), name: `Pestaña ${n}` };
  config.profiles.push(profile);
  return openProfile(profile.id);
}

// Cerrar una pestaña NO borra el perfil ni su sesión: solo libera la vista.
function closeTab(tabId) {
  const idx = config.tabs.findIndex((t) => t.id === tabId);
  if (idx <= 0) return; // idx 0 = pestaña principal (no se cierra)

  const [tab] = config.tabs.splice(idx, 1);
  const view = views.get(tab.id);
  if (view) {
    win.contentView.removeChildView(view);
    view.webContents.close();
    views.delete(tab.id);
  }
  titles.delete(tab.id);
  const ses = session.fromPartition(`persist:murcord-${tab.profileId}`);
  ses.flushStorageData();
  ses.cookies.flushStore();

  if (config.activeTabId === tab.id) {
    const next = config.tabs[Math.min(idx, config.tabs.length - 1)];
    return activateTab(next.id);
  }
  saveConfig();
  pushState();
  return layout();
}

// El nombre pertenece al perfil: se conserva aunque cierres la pestaña.
function renameTab(tabId, name) {
  const tab = config.tabs.find((t) => t.id === tabId);
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!tab || !clean) return;
  const profile = config.profiles.find((p) => p.id === tab.profileId);
  if (!profile) return;
  profile.name = clean;
  saveConfig();
  pushState();
  const view = views.get(config.activeTabId);
  if (view) view.webContents.focus();
}

function selectTabByIndex(i) {
  const tab = config.tabs[i];
  if (tab) activateTab(tab.id);
}

function selectRelative(step) {
  const n = config.tabs.length;
  const i = config.tabs.findIndex((t) => t.id === config.activeTabId);
  selectTabByIndex((i + step + n) % n);
}

function showNewTabMenu() {
  const items = config.profiles.map((p) => {
    const isOpen = config.tabs.some((t) => t.profileId === p.id);
    return {
      label: isOpen ? `✓ ${p.name} (abierta)` : p.name,
      click: () => openProfile(p.id),
    };
  });
  Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    { label: 'Nueva pestaña', click: () => createProfile() },
    { type: 'separator' },
    { label: `Murcord ${app.getVersion()} · Buscar actualizaciones`, click: () => checkForUpdates(true) },
  ]).popup({ window: win });
}

/* ---------- Atajos de teclado ---------- */

function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = String(input.key).toLowerCase();
  const view = views.get(config.activeTabId);

  if (ctrl && !input.alt && !input.shift && key === 't') {
    event.preventDefault(); showNewTabMenu();
  } else if (ctrl && !input.alt && !input.shift && key === 'w') {
    event.preventDefault(); closeTab(config.activeTabId);
  } else if (ctrl && !input.alt && key === 'tab') {
    event.preventDefault(); selectRelative(input.shift ? -1 : 1);
  } else if (input.alt && !ctrl && !input.shift && /^[0-9]$/.test(key)) {
    event.preventDefault(); selectTabByIndex((key === '0' ? 10 : Number(key)) - 1);
  } else if (ctrl && !input.alt && !input.shift && key === 'r') {
    event.preventDefault(); if (view) view.webContents.reload();
  } else if (ctrl && !input.alt && input.shift && key === 'i') {
    event.preventDefault(); if (view) view.webContents.openDevTools({ mode: 'detach' });
  }
}

/* ---------- Actualizaciones automáticas (GitHub Releases) ---------- */

async function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'info',
        message: 'Las actualizaciones solo funcionan en la versión instalada de Murcord.',
      });
    }
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!manual) return;
    if (result && result.isUpdateAvailable) {
      dialog.showMessageBox(win, {
        type: 'info',
        message: 'Hay una actualización disponible',
        detail: 'Se está descargando en segundo plano. Te avisaré cuando esté lista.',
      });
    } else {
      dialog.showMessageBox(win, {
        type: 'info',
        message: 'Murcord está actualizado',
        detail: `Versión ${app.getVersion()}`,
      });
    }
  } catch (err) {
    console.error('[Murcord] Error al buscar actualizaciones:', err);
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'error',
        message: 'No se pudo buscar actualizaciones',
        detail: String((err && err.message) || err),
      });
    }
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // en desarrollo no se actualiza
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('error', (err) => {
    console.error('[Murcord] Error de actualización:', (err && err.message) || err);
  });
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Actualización lista',
      message: `Murcord ${info.version} está listo para instalarse`,
      detail: 'Se instalará al cerrar Murcord, o puedes reiniciar ahora. Tus pestañas y sesiones se conservan.',
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000); // cada 4 horas
}

/* ---------- Ventana ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Murcord',
    backgroundColor: '#1e1f22',
    // Barra de título integrada: los botones de minimizar/maximizar/cerrar se dibujan sobre nuestra barra.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1f22', symbolColor: '#b5bac1', height: TABBAR_HEIGHT },
    icon: path.join(__dirname, '../../resources/murcord-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/tabbar.html'));
  win.webContents.on('did-finish-load', pushState);
  win.webContents.on('before-input-event', handleShortcut);
  ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
    .forEach((evt) => win.on(evt, layout));
  win.on('closed', () => { win = null; });
}

// Solo aceptamos mensajes que vengan de la barra de pestañas.
function fromTabbar(e) {
  return win && e.sender === win.webContents;
}

function start() {
  userAgent = app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(/\smurcord\/\S+/i, '');
  config = loadConfig();
  equicord = loadEquicordBundle();
  Menu.setApplicationMenu(null);

  ipcMain.handle('get-state', (e) => (fromTabbar(e) ? buildState() : null));
  ipcMain.on('tab:activate', (e, id) => { if (fromTabbar(e)) activateTab(id); });
  ipcMain.on('tab:close', (e, id) => { if (fromTabbar(e)) closeTab(id); });
  ipcMain.on('tab:rename', (e, id, name) => { if (fromTabbar(e)) renameTab(id, name); });
  ipcMain.on('tab:new', (e) => { if (fromTabbar(e)) showNewTabMenu(); });

  // El preload de cada pestaña pide aquí el código de Equicord.
  ipcMain.on('murcord:get-equicord', (e) => {
    e.returnValue = isDiscordSender(e) ? equicord : { js: null, css: null };
  });

  // Equivalente a GM_xmlhttpRequest: peticiones de red sin CORS para Equicord.
  ipcMain.handle('murcord:gm-request', async (e, d) => {
    if (!isDiscordSender(e)) throw new Error('Remitente no permitido');
    const url = new URL(String(d.url));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Protocolo no permitido');

    const method = String(d.method || 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const res = await net.fetch(url.href, {
      method,
      headers: d.headers || {},
      body: hasBody && d.data != null ? d.data : undefined,
      redirect: 'follow',
    });
    return {
      status: res.status,
      statusText: res.statusText,
      finalUrl: res.url,
      headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n'),
      buffer: await res.arrayBuffer(),
    };
  });

  createWindow();
  activateTab(config.activeTabId);
  setupAutoUpdate();
}

/* ---------- Ciclo de vida ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('before-quit', () => {
    if (!config) return;
    for (const p of config.profiles) {
      const ses = session.fromPartition(`persist:murcord-${p.id}`);
      ses.flushStorageData();
      ses.cookies.flushStore();
    }
    saveConfig();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start);
}
