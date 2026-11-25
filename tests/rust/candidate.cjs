const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-rust-candidate-'));
const port = process.env.PORT || '3399';
const child = spawn(path.join(root, 'rust/target/debug', `multiplexity-server${process.platform === 'win32' ? '.exe' : ''}`), [], {
  cwd: root, windowsHide: true, stdio: 'inherit',
  env: { ...process.env, PORT: port, MULTIPLEXITY_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    MULTIPLEXITY_DATA_DIR: directory, MULTIPLEXITY_FRONTEND_DIR: path.join(root, 'dist/client') },
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
