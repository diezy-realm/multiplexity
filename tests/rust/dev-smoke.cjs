const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const port = 3390;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-rust-dev-'));
const child = fork(path.join(root, 'scripts/rust-web.cjs'), [], { cwd: root, env: { ...process.env, PORT: String(port), MULTIPLEXITY_API_PORT: String(port + 1), MULTIPLEXITY_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let diagnostics = '';
child.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000); });
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000); });
async function main() {
  let response;
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Development launcher exited: ${diagnostics}`);
    try { response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(response?.status, 200, diagnostics);
  assert.equal((await response.json()).backend, 'rust');
  const html = await fetch(origin + '/login').then(response => response.text());
  assert.match(html, /@vite\/client/);
  const setup = await fetch(origin + '/api/auth/desktop-setup');
  assert.equal((await setup.json()).setupRequired, true);
  const created = await fetch(origin + '/api/auth/desktop-setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'devfixture', password: 'isolated-dev-password' }) });
  assert.equal(created.status, 201);
  console.log('RUST_VITE_DEV_SMOKE_OK');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  if (child.connected) { child.send({ type: 'shutdown' }); child.disconnect(); }
  else if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
});
