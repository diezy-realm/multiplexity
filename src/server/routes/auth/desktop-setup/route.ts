import bcrypt from 'bcrypt';
import { getDb } from '@/lib/db';
import { hasDesktopAccess } from '@/lib/desktop/access';
import { hasLocalWebAccess } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!hasDesktopAccess(request.headers.get('cookie') ?? undefined) && !hasLocalWebAccess(request)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const existing = getDb().prepare('SELECT 1 FROM users LIMIT 1').get();
  return Response.json({ setupRequired: !existing });
}

export async function POST(request: Request) {
  if ((!hasDesktopAccess(request.headers.get('cookie') ?? undefined) && !hasLocalWebAccess(request)) ||
      request.headers.get('origin') !== process.env.NEXTAUTH_URL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (getDb().prepare('SELECT 1 FROM users LIMIT 1').get()) {
    return Response.json({ error: 'Akun sudah dibuat' }, { status: 409 });
  }
  let data;
  try { data = await request.json(); }
  catch { return Response.json({ error: 'Data tidak valid' }, { status: 400 }); }
  const { username, password } = data ?? {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username) ||
      typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
    return Response.json({ error: 'Username 3–64 karakter; password minimal 12 karakter dan maksimal 72 byte.' }, { status: 400 });
  }
  const hash = await bcrypt.hash(password, 12);
  // Recheck within the write transaction to prevent concurrent first-user creation.
  const created = getDb().transaction(() => {
    if (getDb().prepare('SELECT 1 FROM users LIMIT 1').get()) return false;
    getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    return true;
  })();
  return created
    ? Response.json({ success: true }, { status: 201 })
    : Response.json({ error: 'Akun sudah dibuat' }, { status: 409 });
}
