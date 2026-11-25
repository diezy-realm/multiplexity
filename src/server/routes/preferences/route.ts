import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';

function validScope(scope: unknown): scope is string {
  return typeof scope === 'string' && /^(vm-cards|service-cards:[a-zA-Z0-9-]+)$/.test(scope) && scope.length < 150;
}

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = new URL(request.url).searchParams.get('scope');
  if (!validScope(scope)) return Response.json({ error: 'Invalid scope' }, { status: 400 });
  const userId = (session.user as { id: string }).id;
  const row = getDb().prepare('SELECT value FROM ui_preferences WHERE user_id = ? AND scope = ?').get(userId, scope) as { value: string } | undefined;
  return Response.json({ order: row ? JSON.parse(row.value) : [] });
}

export async function PUT(request: Request) {
  const session = await getServerSession();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !validScope(body.scope) || !Array.isArray(body.order) || body.order.length > 1000 ||
      body.order.some((id: unknown) => typeof id !== 'string' || id.length > 256) || new Set(body.order).size !== body.order.length) {
    return Response.json({ error: 'Invalid order' }, { status: 400 });
  }
  const userId = (session.user as { id: string }).id;
  getDb().prepare('INSERT INTO ui_preferences (user_id, scope, value) VALUES (?, ?, ?) ON CONFLICT(user_id, scope) DO UPDATE SET value = excluded.value')
    .run(userId, body.scope, JSON.stringify(body.order));
  return Response.json({ success: true });
}
