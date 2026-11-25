const path = require('node:path');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multiplexity-node-reference-'));
const port = process.env.PORT || '3399';
const child = fork(path.join(root, 'server.ts'), [], {
  cwd: root,
  execArgv: ['--import', 'tsx'],
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', DESKTOP_MODE: '0', MANAGER_LOCAL_DEV: '0',
    NEXTAUTH_URL: `http://127.0.0.1:${port}`, NEXTAUTH_URL_INTERNAL: `http://127.0.0.1:${port}`,
    ENCRYPTION_KEY: '01'.repeat(32), NEXTAUTH_SECRET: 'isolated-reference-fixture',
    DATABASE_PATH: path.join(directory, 'reference.db'), MANAGER_DATA_PATH: directory },
});
const stop = () => { if (child.connected) child.send({ type: 'shutdown' }); else child.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', code => { process.exitCode = code || 0; });
