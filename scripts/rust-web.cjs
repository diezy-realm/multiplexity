const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const production = process.argv.includes('--production');
const children = new Set();
let stopping = false;

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
function wait(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed (${code}).`)));
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else child.kill('SIGTERM');
  }
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
process.once('disconnect', () => stop());
process.on('message', message => { if (message?.type === 'shutdown') stop(); });

function health(apiPort, publicPort) {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port: apiPort, path: '/api/health', headers: { Host: `localhost:${publicPort}` }, timeout: 1000 }, response => {
      let size = 0;
      let body = '';
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) request.destroy();
        else body += chunk;
      });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && JSON.parse(body).backend === 'rust'); }
        catch { resolve(false); }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}
async function ready(apiPort, publicPort) {
  const deadline = Date.now() + 30000;
  while (!stopping && Date.now() < deadline) {
    if (await health(apiPort, publicPort)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(stopping ? 'Backend stopped during startup.' : 'Backend Rust tidak siap dalam 30 detik.');
}

async function main() {
  const port = Number(process.env.PORT || 3300);
  if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error('PORT harus 1–65534.');
  const profile = production ? 'release' : 'debug';
  const extension = process.platform === 'win32' ? '.exe' : '';
  const binary = path.join(root, 'rust', 'target', profile, `multiplexity-server${extension}`);
  if (!production || !fs.existsSync(binary)) {
    await wait(launch('cargo', ['build', '--manifest-path', 'rust/Cargo.toml', '--package', 'multiplexity-backend', '--bin', 'multiplexity-server', ...(production ? ['--release'] : [])]));
  }
  const apiPort = production ? port : Number(process.env.MULTIPLEXITY_API_PORT || port + 1);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('MULTIPLEXITY_API_PORT harus 1–65535.');
  const environment = {
    ...process.env,
    PORT: String(apiPort),
    MULTIPLEXITY_PUBLIC_ORIGIN: `http://localhost:${port}`,
    MULTIPLEXITY_FRONTEND_DIR: path.join(root, 'dist', 'client'),
    MULTIPLEXITY_DATA_DIR: process.env.MULTIPLEXITY_DATA_DIR || path.join(root, '.local-dev', 'rust'),
  };
  const backend = launch(binary, [], { env: environment });
  backend.once('error', error => { console.error(error.message); stop(1); });
  backend.once('exit', code => { if (!stopping) stop(code || 0); });
  await ready(apiPort, port);
  if (!production) {
    const vite = launch(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', 'localhost', '--port', String(port), '--strictPort'], { env: { ...environment, MULTIPLEXITY_API_PORT: String(apiPort) } });
    vite.once('error', error => { console.error(error.message); stop(1); });
    vite.once('exit', code => { if (!stopping) stop(code || 0); });
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); stop(1); });
module.exports = { main };
