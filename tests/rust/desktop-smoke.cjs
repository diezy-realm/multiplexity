const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { loginFixture, verifyCodeReview, verifyLibrary } = require('./code-review-flow.cjs');
const { verifyAIProviders } = require('./ai-provider-flow.cjs');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-tauri-smoke-'));
const profile = process.argv.includes('--debug') ? 'debug' : 'release';
const executable = path.join(root, 'rust/target', profile, `multiplexity-desktop${process.platform === 'win32' ? '.exe' : ''}`);
const environment = { ...process.env, MULTIPLEXITY_SMOKE_DATA_DIR: directory };
delete environment.MULTIPLEXITY_PUBLIC_ORIGIN;
let child;

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function connectWebView(port, origin) {
  const deadline = Date.now() + 20000;
  let page;
  while (!page && Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) });
      page = (await response.json()).find(item => item.type === 'page' && item.url.startsWith(origin + '/'));
    } catch {
      // The WebView2 debugging endpoint starts after the native window.
    }
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('WebView2 debugging endpoint did not expose the Multiplexity window');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebView2 debugging connection failed')), { once: true });
  });
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    const callback = pending.get(response.id);
    if (callback) callback(response);
  });
  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('WebView2 command timed out: ' + method));
      }, 5000);
      pending.set(id, response => {
        clearTimeout(timer);
        pending.delete(id);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return {
    close: () => socket.close(),
    capture: async name => {
      const output = path.join(root, '.test-artifacts/code-review');
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'tauri-' + name + '.png'), Buffer.from(screenshot.data, 'base64'));
    },
    evaluate: async expression => {
      const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text);
      return answer.result.value;
    },
  };
}

async function main() {
  const debugPort = process.platform === 'win32' ? await availablePort() : null;
  if (debugPort) {
    environment.WEBVIEW2_USER_DATA_FOLDER = path.join(directory, 'webview');
    environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + debugPort;
  }
  child = spawn(executable, ['--smoke-test'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-2000); });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tauri startup timed out: ' + errorOutput)), 45000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/MULTIPLEXITY_DESKTOP_READY (http:\/\/localhost:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Tauri exited ${code}: ${errorOutput}`)); });
  });
  const health = await fetch(origin + '/api/health').then(response => response.json());
  assert.equal(health.backend, 'rust');
  const html = await fetch(origin + '/login').then(response => response.text());
  assert.match(html, /<title>Multiplexity<\/title>/);
  assert.match(html, /theme-bootstrap\.js/);
  assert.equal((await fetch(origin + '/theme-bootstrap.js')).status, 200);
  const setup = await fetch(origin + '/api/auth/desktop-setup').then(response => response.json());
  assert.equal(setup.setupRequired, true);
  assert.equal((await fetch(origin + '/api/auth/hello', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 410);
  if (debugPort) {
    const webview = await connectWebView(debugPort, origin);
    try {
      await loginFixture(webview.evaluate, 'taurireviewfixture');
      assert.equal(await webview.evaluate("fetch('/api/scm/profile').then(r=>r.json()).then(v=>v.desktopOpen)"), true);
      await verifyLibrary(webview.evaluate);
      console.log('TAURI_WEBVIEW_LIBRARY_OK');
      await verifyCodeReview(webview.evaluate, { capture: webview.capture });
      console.log('TAURI_WEBVIEW_CODE_REVIEW_OK');
      await verifyAIProviders(webview.evaluate);
      console.log('TAURI_WEBVIEW_AI_PROVIDERS_OK');
    } finally {
      webview.close();
    }
  }
  console.log('TAURI_RUST_DESKTOP_SMOKE_OK');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
});
