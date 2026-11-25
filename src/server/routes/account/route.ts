import bcrypt from 'bcrypt';
import { currentUserId } from '@/lib/user';
import { getDb } from '@/lib/db';
import { changePassword, consumeGrant, validPassword } from '@/lib/account';

export async function GET() {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const account = getDb().prepare('SELECT username, created_at FROM users WHERE id = ?').get(user);
  const passkey = !!getDb().prepare('SELECT id FROM passkeys WHERE user_id = ? LIMIT 1').get(user);
  return Response.json({ account, windowsHello: passkey });
}
export async function POST(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !validPassword(body.newPassword)) return Response.json({ error: 'Password minimal 12 karakter dan maksimal 72 byte.' }, { status: 400 });
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(user) as { password_hash: string } | undefined;
  const verified = row && typeof body.currentPassword === 'string' && await bcrypt.compare(body.currentPassword, row.password_hash);
  if (!verified && !consumeGrant(user, body.grant)) return Response.json({ error: 'Verifikasi password atau Windows Hello diperlukan.' }, { status: 403 });
  await changePassword(user, body.newPassword);
  return Response.json({ success: true, signInRequired: true });
}
