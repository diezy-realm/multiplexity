const { app, BrowserWindow, dialog, safeStorage, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { loadSettings } = require('./settings.cjs');
const { openCliLogin } = require('./cli-login.cjs');

let backend;
let mainWindow;
let quitting = false;
let backendExited = false;
let origin;
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Manager System Internal'));
const smokeTest = process.argv.includes('--desktop-smoke-test');
if (smokeTest) {
  const fs = require('node:fs');
  const os = require('node:os');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'manager-desktop-smoke-')));
}

async function startBackend(directory, settings, accessToken) {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(__dirname, '..');
  const runtime = path.join(root, 'desktop-dist', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  backend = spawn(runtime, [path.join(root, 'desktop-dist', 'server.cjs')], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: '',
      NODE_PATH: '',
      DESKTOP_MODE: '1',
      DESKTOP_WEB_HOST: 'localhost',
      DESKTOP_ACCESS_TOKEN: accessToken,
      DATABASE_PATH: path.join(directory, 'dashboard.db'),
      MANAGER_DATA_PATH: directory,
      ENCRYPTION_KEY: settings.encryptionKey,
      NEXTAUTH_SECRET: settings.authSecret,
      NEXTAUTH_URL: '',
      HOSTNAME: '127.0.0.1',
      PORT: '0',
    },
  });
  // Drain pipes without writing credentials, query results, or remote logs to disk.
  backend.stdout.on('data', () => {});
  backend.stderr.on('data', () => {});
  backend.on('message', message => { if (message?.type === 'cli-login' && !smokeTest && !quitting) openCliLogin(message); });
  backend.on('exit', () => {
    backendExited = true;
    if (!quitting && origin) {
      fail(new Error('Backend lokal berhenti. Tutup dan buka kembali aplikasi.'));
    }
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Backend lokal tidak siap dalam 60 detik.')); }, 60000);
    const cleanup = () => {
      clearTimeout(timer);
      backend.off('error', onError);
      backend.off('exit', onExit);
      backend.off('message', onMessage);
    };
    const onError = () => { cleanup(); reject(new Error('Tidak dapat menjalankan runtime Node.js desktop.')); };
    const onExit = () => { cleanup(); reject(new Error('Backend lokal gagal dimulai.')); };
    const onMessage = (message) => {
      if (message?.type === 'ready' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(message.origin)) {
        cleanup();
        resolve(message.origin);
      }
    };
    backend.once('error', onError);
    backend.once('exit', onExit);
    backend.on('message', onMessage);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Multiplexity',
    icon: path.join(app.isPackaged ? path.join(process.resourcesPath,'backend') : path.resolve(__dirname,'..'),'public','brand','multiplexity.ico'),
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'desktop',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: !smokeTest,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowedLinks = ['https://platform.openai.com/api-keys', 'https://platform.claude.com/settings/keys',
      'https://developers.openai.com/codex/auth', 'https://kiro.dev/docs/cli/authentication/', 'https://antigravity.google/docs/cli/install/', 'http://172.18.136.92/'];
    if (allowedLinks.includes(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => { if (!smokeTest) mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(`${origin}/login`);
  if (smokeTest) {
    const mountDeadline=Date.now()+30000;
    while(!await mainWindow.webContents.executeJavaScript("!!document.querySelector('#username')")){
      if(Date.now()>mountDeadline)throw new Error('Login renderer did not mount.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const setup = await fetch('/api/auth/desktop-setup').then(r => r.json());
      return { login: !!document.querySelector('#username'), setupRequired: setup.setupRequired };
    })()`);
    if (!result.login || typeof result.setupRequired !== 'boolean') throw new Error('Desktop smoke test gagal.');
    const password = randomBytes(20).toString('hex');
    await mainWindow.webContents.executeJavaScript(`(async () => {
      const button = document.querySelector('button[type="submit"]');
      const deadline = Date.now() + 10000;
      while (button.disabled) {
        if (Date.now() > deadline) throw new Error('Setup UI timeout');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const [id, value] of [['username', 'desktop-smoke'], ['password', ${JSON.stringify(password)}]]) {
        const input = document.getElementById(id);
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      button.click();
    })()`);
    const deadline = Date.now() + 20000;
    while (!await mainWindow.webContents.executeJavaScript(`location.pathname === '/' &&
      [...document.querySelectorAll('h1')].some(node => node.textContent === 'Virtual Machines')`)) {
      if (Date.now() > deadline) throw new Error('Desktop login UI timeout.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const authenticated = await mainWindow.webContents.executeJavaScript(`fetch('/api/auth/session').then(r => r.json()).then(s => s.user?.name === 'desktop-smoke')`);
    if (!authenticated) throw new Error('Desktop session tidak valid.');
    const shellGeometry=await mainWindow.webContents.executeJavaScript(`(() => {
      const shell=document.querySelector('.app-shell').getBoundingClientRect();
      const header=document.querySelector('[data-testid="page-header"]').getBoundingClientRect();
      const sidebar=document.querySelector('nav[aria-label="Navigasi utama"]').closest('aside').getBoundingClientRect();
      const logout=document.querySelector('[aria-label="Logout"]').getBoundingClientRect();
      return {fullHeight:Math.abs(shell.height-innerHeight)<2,headerClear:header.x>=sidebar.right-1,sidebarHeight:Math.abs(sidebar.height-shell.height)<2,logoutBottom:logout.bottom>shell.bottom-40};
    })()`);
    if(Object.values(shellGeometry).some(value=>!value))throw new Error('Shell layout geometry failed: '+JSON.stringify(shellGeometry));
    mainWindow.showInactive();
    await new Promise(resolve => setTimeout(resolve, 750));
    const image = await mainWindow.webContents.capturePage();
    const screenshot = path.join(app.getPath('userData'), 'desktop-smoke.png');
    require('node:fs').writeFileSync(screenshot, image.toPNG());
    console.log('DESKTOP_SMOKE_OK', JSON.stringify(result));
    console.log('DESKTOP_SMOKE_SCREENSHOT', screenshot);
    if (process.argv.includes('--desktop-priorities-only')) {
      await require('./verify-priorities.cjs').verifyPriorities(mainWindow, origin, app.getPath('userData'));
      app.quit(); return;
    }
    if(process.argv.includes('--desktop-composer-only')){
      await require('./verify-composer.cjs').verifyComposer(mainWindow,origin,app.getPath('userData'));
      await require('./verify-streaming.cjs').verifyStreaming(mainWindow,origin,app.getPath('userData'));
      app.quit();return;
    }
    if (process.argv.includes('--desktop-konga-only')) {
      await require('./verify-konga.cjs').verifyKonga(mainWindow, origin, app.getPath('userData'));
      app.quit(); return;
    }
    await require('./verify-ui.cjs').verifyUI(mainWindow, origin, app.getPath('userData'));
    await require('./verify-hello.cjs').verifyHello(mainWindow, origin, password);
    await require('./verify-workspace.cjs').verifyWorkspace(mainWindow, origin, app.getPath('userData'));
    await require('./verify-multiplexity.cjs').verifyMultiplexity(mainWindow, origin, app.getPath('userData'));
    await require('./verify-konga.cjs').verifyKonga(mainWindow, origin, app.getPath('userData'));
    await require('./verify-streaming.cjs').verifyStreaming(mainWindow, origin, app.getPath('userData'));
    await require('./verify-priorities.cjs').verifyPriorities(mainWindow, origin, app.getPath('userData'));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    const directory = app.getPath('userData');
    const settings = await loadSettings(directory, safeStorage);
    if (smokeTest) {
      const restored = await loadSettings(directory, safeStorage);
      if (restored.encryptionKey !== settings.encryptionKey || restored.authSecret !== settings.authSecret) {
        throw new Error('Desktop key persistence gagal.');
      }
    }
    const accessToken = randomBytes(32).toString('hex');
    origin = await startBackend(directory, settings, accessToken);
    const desktopSession = session.fromPartition('desktop');
    desktopSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write' && contents.getURL().startsWith(`${origin}/`));
    });
    desktopSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      permission === 'clipboard-sanitized-write' && requestingOrigin === origin);
    await desktopSession.cookies.set({
      url: origin,
      name: 'desktop-access',
      value: accessToken,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    await createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow().catch(fail);
    });
  }).catch(fail);
}

function fail(error) {
  process.exitCode = 1;
  if (smokeTest) console.error(error.message);
  else dialog.showErrorBox('Desktop gagal dimulai', error.message);
  app.quit();
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (event) => {
  if (quitting || !backend || backendExited) return;
  event.preventDefault();
  quitting = true;
  const timer = setTimeout(() => { backend.kill(); }, 8000);
  backend.once('exit', () => { clearTimeout(timer); app.exit(process.exitCode || 0); });
  if (backend.connected) backend.send({ type: 'shutdown' });
  else backend.kill();
});
