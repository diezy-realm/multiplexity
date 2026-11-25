import { currentUserId } from '@/lib/user';
import { getDb } from '@/lib/db';
import { defaultAppearance, validAppearance } from '@/lib/appearance';
export async function GET() {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const row = getDb().prepare('SELECT value FROM app_preferences WHERE user_id = ?').get(user) as { value: string } | undefined;
  return Response.json(row ? JSON.parse(row.value) : defaultAppearance);
}
export async function PUT(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!validAppearance(body)) return Response.json({ error: 'Tampilan tidak valid.' }, { status: 400 });
  getDb().prepare('INSERT INTO app_preferences (user_id,value) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value').run(user, JSON.stringify(body));
  return Response.json({ success: true });
}
