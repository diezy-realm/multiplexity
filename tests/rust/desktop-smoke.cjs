const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-tauri-smoke-'));
const executable = path.join(root, 'rust/target/release', `multiplexity-desktop${process.platform === 'win32' ? '.exe' : ''}`);
const environment = { ...process.env, MULTIPLEXITY_SMOKE_DATA_DIR: directory };
delete environment.MULTIPLEXITY_PUBLIC_ORIGIN;
const child = spawn(executable, ['--smoke-test'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
async function main() {
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
  console.log('TAURI_RUST_DESKTOP_SMOKE_OK');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  if (process.platform === 'win32') spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
});
