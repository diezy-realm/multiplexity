import { getDb } from '@/lib/db';
import { validPassword, consumeGrant, changePassword } from '@/lib/account';

export async function POST(request: Request) {
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body.username !== 'string' || body.username.length > 64 || !validPassword(body.newPassword)) return Response.json({ error: 'Data tidak valid.' }, { status: 400 });
  const account = getDb().prepare('SELECT id FROM users WHERE username = ?').get(body.username) as { id: string } | undefined;
  if (!account || !consumeGrant(account.id, body.grant)) return Response.json({ error: 'Verifikasi Windows Hello diperlukan.' }, { status: 403 });
  await changePassword(account.id, body.newPassword);
  return Response.json({ success: true });
}
