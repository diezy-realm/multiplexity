import { canUseLocalCli, isLocalDevelopment } from '@/lib/runtime';
import { getServerSession } from '@/server/auth/session';
import { isProvider, validModel, PROVIDERS } from '@/lib/ai/catalog';
import { activeProvider, getConnection, publicConnections, saveConnection } from '@/lib/ai/settings';
import { findCli } from '@/lib/ai/cli';
import { getDb } from '@/lib/db';

export async function DELETE(request: Request) {
  if (!await getServerSession()) return Response.json({error:'Unauthorized'},{status:401});
  let body; try {body=await request.json();}catch{return Response.json({error:'Invalid JSON'},{status:400});}
  if (!isProvider(body?.provider)) return Response.json({error:'Provider tidak valid.'},{status:400});
  getDb().prepare('DELETE FROM ai_connections WHERE provider = ?').run(body.provider);
  if (body.provider === 'openai') getDb().prepare("UPDATE ai_settings SET api_key_encrypted='', api_key_iv='', api_key_auth_tag='' WHERE id='default'").run();
  if (activeProvider() === body.provider) getDb().prepare("UPDATE ai_settings SET provider = 'openai', model = '' WHERE id = 'default'").run();
  return Response.json({success:true});
}

export async function GET() {
  if (!await getServerSession()) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const connections = publicConnections().map(connection => {
    const api = PROVIDERS.find(item => item.id === connection.provider)?.mode === 'api';
    const executable = !api && canUseLocalCli() ? findCli(connection.provider, connection.cliPath) : null;
    return { ...connection, available: api || !!executable, executable: executable ?? '' };
  });
  const selected = connections.find(item => item.provider === activeProvider())!;
  return Response.json({ ...selected, connections, desktop: process.env.DESKTOP_MODE === '1', localCli: isLocalDevelopment(), runtime: isLocalDevelopment() ? 'local-development' : process.env.DESKTOP_MODE === '1' ? 'desktop' : 'web' });
}

export async function POST(request: Request) {
  if (!await getServerSession()) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !isProvider(body.provider) || !validModel(body.model) ||
      (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 4096)) ||
      (body.clearKey !== undefined && typeof body.clearKey !== 'boolean') ||
      // eslint-disable-next-line no-control-regex -- Reject null bytes in executable paths.
      (body.cliPath !== undefined && (typeof body.cliPath !== 'string' || body.cliPath.length > 1024 || /[\r\n\x00]/.test(body.cliPath)))) {
    return Response.json({ error: 'Konfigurasi tidak valid.' }, { status: 400 });
  }
  const definition = PROVIDERS.find(item => item.id === body.provider)!;
  if (body.endpoint !== undefined && typeof body.endpoint !== 'string') return Response.json({error:'Endpoint tidak valid.'},{status:400});
  const endpoint = body.endpoint?.trim() || '';
  if (endpoint) { try { const url = new URL(endpoint); if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error(); } catch { return Response.json({error:'Gunakan endpoint HTTPS atau HTTP localhost tanpa kredensial/query.'},{status:400}); } }
  if (body.provider === 'custom' && !endpoint) return Response.json({error:'Endpoint API wajib diisi.'},{status:400});
  const key = body.apiKey?.trim() ?? '';
  let cliPath = body.cliPath?.trim() ?? '';
  if ((key && key.length < 10) || (definition.mode === 'api' && !['ollama','custom'].includes(body.provider) && !body.clearKey && !key && !getConnection(body.provider).apiKey)) {
    return Response.json({ error: 'API key wajib diisi.' }, { status: 400 });
  }
  if (body.provider === 'codex' && key) return Response.json({ error: 'Gunakan login resmi Codex CLI atau provider OpenAI untuk API key.' }, { status: 400 });
  if (definition.mode === 'cli' && cliPath) {
    const resolved = findCli(body.provider, cliPath);
    if (!resolved) return Response.json({ error: 'Executable CLI tidak ditemukan. Isi file .exe atau folder instalasinya.' }, { status: 400 });
    cliPath = resolved;
  }
  saveConnection(body.provider, body.model, key, cliPath, body.clearKey === true, endpoint);
  return Response.json({ success: true });
}
