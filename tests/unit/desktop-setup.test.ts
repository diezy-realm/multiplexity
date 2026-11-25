import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import bcrypt from 'bcrypt';
import { closeDb, getDb } from '@/lib/db';
import { GET, POST } from '@/server/routes/auth/desktop-setup/route';
import { hasDesktopAccess } from '@/lib/desktop/access';

let directory: string;
const origin = 'http://127.0.0.1:34567';
const token = 'a'.repeat(64);

function request(body?: object, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/desktop-setup`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: `desktop-access=${token}`, origin, 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  closeDb();
  directory = mkdtempSync(path.join(tmpdir(), 'manager-desktop-setup-'));
  vi.stubEnv('DATABASE_PATH', path.join(directory, 'dashboard.db'));
  vi.stubEnv('DESKTOP_MODE', '1');
  vi.stubEnv('DESKTOP_ACCESS_TOKEN', token);
  vi.stubEnv('NEXTAUTH_URL', origin);
});

afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('Desktop first-run setup', () => {
  it('does not expose setup outside the desktop session', async () => {
    expect((await GET(request(undefined, { cookie: '' }))).status).toBe(404);
    vi.stubEnv('DESKTOP_MODE', '');
    expect((await GET(request())).status).toBe(404);
  });

  it('rejects malformed cookies without throwing', () => {
    expect(hasDesktopAccess(`desktop-access=${'é'.repeat(64)}`)).toBe(false);
    expect(hasDesktopAccess('desktop-access=%FF')).toBe(false);
  });

  it('creates a hashed account once without inserting sample VMs', async () => {
    expect(await (await GET(request())).json()).toEqual({ setupRequired: true });
    const credentials = { username: 'desktop-admin', password: 'desktop-test-password' };
    expect((await POST(request(credentials))).status).toBe(201);
    const user = getDb().prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    expect(await bcrypt.compare(credentials.password, user.password_hash)).toBe(true);
    expect(await (await GET(request())).json()).toEqual({ setupRequired: false });
    expect((await POST(request(credentials))).status).toBe(409);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM vms').get()).toEqual({ count: 0 });
  });

  it('rejects a foreign origin and invalid credentials', async () => {
    const credentials = { username: 'admin', password: 'desktop-test-password' };
    expect((await POST(request(credentials, { origin: 'https://example.com' }))).status).toBe(403);
    expect((await POST(request({ ...credentials, password: 'short' }))).status).toBe(400);
    expect((await POST(request({ ...credentials, password: 'é'.repeat(40) }))).status).toBe(400);
    expect((await POST(request({ ...credentials, username: '../admin' }))).status).toBe(400);
  });

  it('allows only one account during concurrent setup', async () => {
    const credentials = { username: 'admin', password: 'desktop-test-password' };
    const responses = await Promise.all([POST(request(credentials)), POST(request({ ...credentials, username: 'admin2' }))]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
  });
});
