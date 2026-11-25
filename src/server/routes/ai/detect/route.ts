import { canUseLocalCli } from '@/lib/runtime';
import { getServerSession } from '@/server/auth/session';
import { isProvider } from '@/lib/ai/catalog';
import { findCli, windowsSearchPath } from '@/lib/ai/cli-discovery';

export async function POST(request: Request) {
  if (!await getServerSession()) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseLocalCli()) return Response.json({ error: 'Deteksi CLI tersedia pada desktop atau development lokal.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !isProvider(body.provider) || !['codex', 'kiro', 'antigravity'].includes(body.provider) ||
      // eslint-disable-next-line no-control-regex -- Reject null bytes in executable paths.
      (body.path !== undefined && (typeof body.path !== 'string' || body.path.length > 1024 || /[\r\n\x00]/.test(body.path)))) {
    return Response.json({ error: 'Provider atau path tidak valid.' }, { status: 400 });
  }
  windowsSearchPath(true);
  const executable = findCli(body.provider, body.path ?? '');
  return Response.json({ available: !!executable, executable: executable ?? '' });
}
