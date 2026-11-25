const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mode = process.argv.includes('--build') ? 'build' : 'dev';
let current;
function run(command, args) {
  return new Promise((resolve, reject) => {
    current = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, CARGO_TARGET_DIR: path.join(root, 'rust', 'target') } });
    current.once('error', reject);
    current.once('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed (${code}).`)));
  });
}
function stop(signal) {
  if (!current?.pid) return;
  if (process.platform === 'win32') {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(current.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else current.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
async function main() {
  await run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
  if (mode === 'build') await require('./rust-stage-frontend.cjs').stageFrontend();
  const args = [path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), mode];
  if (mode === 'build' && process.argv.includes('--no-bundle')) args.push('--no-bundle');
  await run(process.execPath, args);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
