import { randomUUID } from 'crypto';
import { currentUserId } from '@/lib/user';
import { getDb } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto/credential-store';

export async function GET(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ snippets: getDb().prepare('SELECT id, title, kind, updated_at FROM snippets WHERE user_id = ? ORDER BY updated_at DESC').all(user) });
  const row = getDb().prepare('SELECT * FROM snippets WHERE id = ? AND user_id = ?').get(id, user) as { id: string; title: string; kind: string; ciphertext: string; iv: string; auth_tag: string } | undefined;
  if (!row) return Response.json({ error: 'Snipet tidak ditemukan.' }, { status: 404 });
  return Response.json({ id: row.id, title: row.title, kind: row.kind, content: decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 100 || !['credential','path','script'].includes(body.kind) || typeof body.content !== 'string' || Buffer.byteLength(body.content) > 64000 || (body.id !== undefined && typeof body.id !== 'string')) return Response.json({ error: 'Snipet tidak valid.' }, { status: 400 });
  const id = body.id || randomUUID();
  if (body.id && !getDb().prepare('SELECT id FROM snippets WHERE id = ? AND user_id = ?').get(id, user)) return Response.json({ error: 'Tidak ditemukan.' }, { status: 404 });
  const secret = encrypt(body.content);
  getDb().prepare(`INSERT INTO snippets (id,user_id,title,kind,ciphertext,iv,auth_tag) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,updated_at=CURRENT_TIMESTAMP`).run(id, user, body.title.trim(), body.kind, secret.ciphertext, secret.iv, secret.authTag);
  return Response.json({ id });
}
export async function DELETE(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  getDb().prepare('DELETE FROM snippets WHERE id = ? AND user_id = ?').run(new URL(request.url).searchParams.get('id') ?? '', user);
  return Response.json({ success: true });
}
