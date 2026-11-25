const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-rust-smoke-'));
  const binary = path.join(root, 'rust/target/debug', `multiplexity-server${process.platform === 'win32' ? '.exe' : ''}`);
  const environment = { ...process.env, PORT: '0', MULTIPLEXITY_DATA_DIR: directory, MULTIPLEXITY_FRONTEND_DIR: path.join(root, 'dist/client') };
  delete environment.MULTIPLEXITY_PUBLIC_ORIGIN;
  const child = spawn(binary, [], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000); });
  let socket;
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rust server startup timed out')), 30000);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Multiplexity Rust: (http:\/\/localhost:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${diagnostics}`)); });
    });
    let cookies = '';
    const cookieJar = new Map();
    async function call(route, method = 'GET', body, expected = 200) {
      const response = await fetch(origin + route, { method, headers: { Origin: origin, ...(cookies ? { Cookie: cookies } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, expected, `${method} ${route}`);
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        if (/Max-Age=0(?:;|$)/i.test(cookie)) cookieJar.delete(name);
        else cookieJar.set(name, pair.slice(separator + 1));
      }
      cookies = [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
      return response.status === 204 ? null : response.json();
    }
    assert.equal((await call('/api/health')).backend, 'rust');
    await call('/api/vms', 'GET', undefined, 401);
    assert.equal((await call('/api/auth/desktop-setup')).setupRequired, true);
    await call('/api/auth/desktop-setup', 'POST', { username: 'smokeuser', password: 'isolated-test-password' }, 201);
    const csrf = await call('/api/auth/csrf');
    await call('/api/auth/callback/credentials', 'POST', { username: 'smokeuser', password: 'isolated-test-password', csrfToken: csrf.csrfToken });
    assert.equal((await call('/api/auth/session')).user.name, 'smokeuser');
    const vm = await call('/api/vms', 'POST', { label: 'Fixture VM', host: '127.0.0.1', port: 65534, username: 'fixture', password: 'fixture-secret' }, 201);
    assert.equal(vm.label, 'Fixture VM');
    assert.equal((await call('/api/vms')).length, 1);
    assert.equal((await call(`/api/vms/${vm.id}`, 'PUT', { label: 'Updated fixture' })).label, 'Updated fixture');
    const database = await call('/api/databases', 'POST', { label: 'Fixture DB', dbType: 'postgresql', host: '127.0.0.1', port: 65533, username: 'fixture', password: 'fixture-secret' }, 201);
    assert.equal((await call('/api/databases')).length, 1);
    const snippet = await call('/api/snippets', 'POST', { title: 'Fixture', kind: 'path', content: '/fixture' });
    assert.equal((await call(`/api/snippets?id=${snippet.id}`)).content, '/fixture');
    await call('/api/artifacts', 'POST', { name: 'artifacts/smoke.md', content: '# Rust smoke' });
    assert.equal((await call('/api/artifacts?name=artifacts/smoke.md')).content, '# Rust smoke');
    await call('/api/appearance', 'PUT', { theme: 'dark', fontFamily: 'Segoe UI', fontSize: 15, terminalFontSize: 14, colors: {} });
    assert.equal((await call('/api/appearance')).fontSize, 15);
    assert.equal((await call('/api/account')).windowsHello, false);
    await call('/api/auth/hello', 'POST', {}, 410);
    assert.equal((await call('/api/konga?entity=connection')).connected, false);
    await call('/api/ai/conversations', 'POST', { title: 'Smoke chat' }, 201);
    await call('/api/ai/chat');
    socket = io(origin, { path: '/api/socketio', transports: ['websocket'], extraHeaders: { Cookie: cookies, Origin: origin }, reconnection: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket.IO did not connect')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    });
    const terminalError = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Terminal did not report missing VM')), 5000);
      socket.once('terminal:error', message => { clearTimeout(timer); resolve(message); });
    });
    socket.emit('terminal:open', 'not-a-vm', { cols: 80, rows: 24 });
    assert.equal(typeof await terminalError, 'string');
    socket.disconnect();
    await call(`/api/databases/${database.id}`, 'DELETE');
    await call(`/api/vms/${vm.id}`, 'DELETE');
    const previousSession = cookies;
    const signout = await call('/api/auth/csrf');
    await call('/api/auth/signout', 'POST', { csrfToken: signout.csrfToken });
    await call('/api/vms', 'GET', undefined, 401);
    assert.equal((await fetch(origin + '/api/vms', { headers: { Cookie: previousSession, Origin: origin } })).status, 401);
    console.log('RUST_HTTP_SOCKET_SMOKE_OK');
  } finally {
    socket?.disconnect();
    child.kill();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
