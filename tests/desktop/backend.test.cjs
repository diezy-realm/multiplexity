const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync, cpSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

test('production desktop: private listener, setup, login, socket auth and shutdown', { timeout: 90000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'manager-desktop-backend-'));
  const accessToken = randomBytes(32).toString('hex');
  const runtimeRoot = process.env.DESKTOP_TEST_STAGED === '1' ? path.join(directory, 'runtime') : process.cwd();
  if (process.env.DESKTOP_TEST_STAGED === '1') cpSync(path.resolve('desktop-dist/backend'), runtimeRoot, { recursive: true });
  if (process.env.DESKTOP_TEST_STAGED === '1') {
    const probe = spawnSync(process.execPath, ['-e', 'require("mysql2/promise");require("pg");require("ssh2");require("bcrypt");require("better-sqlite3");require("node:fs").accessSync("dist/client/index.html")'], {cwd:runtimeRoot,env:{...process.env,NODE_ENV:'production'},encoding:'utf8',timeout:30000});
    if (probe.status !== 0) { rmSync(directory,{recursive:true,force:true}); assert.fail(`Isolated shared runtime failed: ${probe.stderr}`); }
  }
  const child = fork(path.join(runtimeRoot, 'desktop-dist/server.cjs'), [], {
    cwd: runtimeRoot,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'production', DESKTOP_MODE: '1', PORT: '0',
      DESKTOP_ACCESS_TOKEN: accessToken,
      NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
      ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      DATABASE_PATH: path.join(directory, 'dashboard.db'),
    },
  });
  let startupError = '';
  child.stderr.on('data', chunk => { startupError = (startupError + chunk.toString()).slice(-4000); });
  try {
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Backend readiness timeout')), 60000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Backend exited during startup: ${startupError}`)); });
      child.on('message', message => {
        if (message?.type === 'ready') { clearTimeout(timeout); resolve(message.origin); }
      });
    });
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(`${origin}/login`)).status, 403);
    const cookies = new Map([['desktop-access', accessToken]]);
    const request = async (endpoint, options = {}) => {
      const response = await fetch(`${origin}${endpoint}`, {
        ...options,
        headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), origin, ...options.headers },
        redirect: 'manual',
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [name, ...parts] = cookie.split(';')[0].split('=');
        cookies.set(name, parts.join('='));
      }
      return response;
    };
    assert.equal((await request('/login', { headers: { origin: 'https://example.com' } })).status, 403);
    assert.equal((await request('/login')).status, 200);
    assert.deepEqual(await (await request('/api/auth/desktop-setup')).json(), { setupRequired: true });
    const credentials = { username: 'desktop-test', password: randomBytes(20).toString('hex') };
    const setup = () => request('/api/auth/desktop-setup', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
    });
    assert.equal((await setup()).status, 201);
    assert.equal((await setup()).status, 409);
    const csrf = await (await request('/api/auth/csrf')).json();
    const login = await request('/api/auth/callback/credentials', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...credentials, csrfToken: csrf.csrfToken, json: 'true', callbackUrl: origin }).toString(),
    });
    assert.equal(login.status, 200);
    const session = await (await request('/api/auth/session')).json();
    assert.equal(session.user.name, credentials.username);
    assert.equal((await request('/api/vms')).status, 200);
    const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    async function connectSocket(headers, accepted) {
      const socket = io(origin, { path: '/api/socketio', transports: ['websocket'], reconnection: false, timeout: 5000, extraHeaders: headers });
      try {
        await new Promise((resolve, reject) => {
          socket.on('connect', () => accepted ? resolve() : reject(new Error('Unauthorized socket connected')));
          socket.on('connect_error', () => accepted ? reject(new Error('Authenticated socket rejected')) : resolve());
        });
      } finally { socket.disconnect(); }
    }
    await connectSocket({ Origin: origin }, false);
    await connectSocket({ Cookie: cookie, Origin: origin }, true);
    const activeSocket = io(origin, { path: '/api/socketio', transports: ['websocket'], reconnection: false, timeout: 5000, extraHeaders: { Cookie: cookie, Origin: origin } });
    await once(activeSocket, 'connect');
    const disconnected = once(activeSocket, 'disconnect');
    const nextPassword = randomBytes(20).toString('hex');
    const changed = await request('/api/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: credentials.password, newPassword: nextPassword }) });
    assert.equal(changed.status, 200);
    await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('Old socket was not disconnected')), 5000).unref())]);
    activeSocket.disconnect();
    assert.equal((await request('/api/vms')).status, 401);
    await connectSocket({ Cookie: cookie, Origin: origin }, false);
    const refreshedCsrf = await (await request('/api/auth/csrf')).json();
    await request('/api/auth/callback/credentials', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: credentials.username, password: nextPassword, csrfToken: refreshedCsrf.csrfToken, json: 'true', callbackUrl: origin }).toString(),
    });
    assert.equal((await request('/api/vms')).status, 200);
    const exited = once(child, 'exit');
    child.send({ type: 'shutdown' });
    const [code] = await exited;
    assert.equal(code, 0);
    await assert.rejects(fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) }));
  } catch (error) {
    if (process.env.DESKTOP_TEST_STAGED === '1') console.error(startupError);
    throw error;
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
