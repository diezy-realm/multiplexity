const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-rust-browser-'));
app.setPath('userData', path.join(directory, 'browser'));
let backend;
let window;
async function wait(script) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await window.webContents.executeJavaScript(script)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Browser state timed out');
}
async function main() {
  await app.whenReady();
  const environment = { ...process.env, PORT: '0', MULTIPLEXITY_DATA_DIR: path.join(directory, 'data'), MULTIPLEXITY_FRONTEND_DIR: path.join(root, 'dist/client') };
  delete environment.MULTIPLEXITY_PUBLIC_ORIGIN;
  backend = spawn(path.join(root, 'rust/target/debug', `multiplexity-server${process.platform === 'win32' ? '.exe' : ''}`), [], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Rust startup timed out')), 30000);
    let output = '';
    backend.stdout.on('data', chunk => { output += chunk; const match = output.match(/Multiplexity Rust: (http:\/\/localhost:\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    backend.once('error', error => { clearTimeout(timeout); reject(error); });
    backend.once('exit', code => { clearTimeout(timeout); reject(new Error(`Rust backend exited ${code}`)); });
  });
  window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('render-process-gone', () => errors.push('Renderer stopped'));
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message.slice(0, 300)); });
  await window.loadURL(origin + '/login');
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Buat Akun'))");
  await window.webContents.executeJavaScript(`{
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    for(const [name,value] of [['username','browserfixture'],['password','browser-test-password']]){
      const input=document.querySelector('input[name="'+name+'"]');setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }`);
  await window.webContents.executeJavaScript("document.querySelector('button[type=submit]').click()");
  await wait("location.pathname==='/' && document.body.textContent.includes('Virtual Machines')");
  assert.equal(await window.webContents.executeJavaScript("fetch('/api/health').then(r=>r.json()).then(v=>v.backend)"), 'rust');
  await window.webContents.executeJavaScript("document.querySelector('a[href=\"/chat\"]').click()");
  await wait("location.pathname==='/chat' && !!document.querySelector('textarea')");
  await window.webContents.executeJavaScript("document.querySelector('a[href=\"/artifacts\"]').click()");
  await wait("location.pathname==='/artifacts' && document.body.textContent.includes('Artifact')");
  await window.webContents.executeJavaScript("document.querySelector('a[href=\"/settings\"]').click()");
  await wait("location.pathname==='/settings' && document.body.textContent.includes('Account')");
  assert.equal(await window.webContents.executeJavaScript("document.body.textContent.includes('Aktifkan Windows Hello')"), false);
  assert.deepEqual(errors, []);
  await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  const screenshot = await window.capturePage();
  const output = path.join(root, '.test-artifacts/rust-migration');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'rust-browser.png'), screenshot.toPNG());
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"Logout\"]').click()");
  await wait("location.pathname==='/login' && !!document.querySelector('button[type=submit]')");
  console.log('RUST_BROWSER_SMOKE_OK');
}
main().then(() => { backend?.kill(); window?.destroy(); app.exit(0); }).catch(error => { console.error(error.message); backend?.kill(); window?.destroy(); app.exit(1); });
