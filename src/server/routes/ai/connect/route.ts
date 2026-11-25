import { canUseLocalCli } from '@/lib/runtime';
import { getServerSession } from '@/server/auth/session';
import { isProvider } from '@/lib/ai/catalog';
import { getConnection } from '@/lib/ai/settings';
import { findCli } from '@/lib/ai/cli';

export async function POST(request: Request) {
  if (!await getServerSession()) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseLocalCli() || !process.send) return Response.json({ error: 'Connect CLI tersedia pada desktop atau development lokal.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !isProvider(body.provider) || !['codex', 'kiro', 'antigravity'].includes(body.provider)) return Response.json({ error: 'Provider CLI tidak valid.' }, { status: 400 });
  const executable = findCli(body.provider, getConnection(body.provider).cliPath);
  if (!executable) return Response.json({ error: 'Pasang CLI resmi atau simpan path executable terlebih dahulu.' }, { status: 400 });
  process.send({ type: 'cli-login', provider: body.provider, executable });
  return Response.json({ message: 'Selesaikan login pada terminal resmi CLI, lalu tes koneksi di sini.' });
}
