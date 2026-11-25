import { canUseLocalCli } from '@/lib/runtime';
import { getServerSession } from '@/server/auth/session';
import { isProvider } from '@/lib/ai/catalog';
import { getConnection } from '@/lib/ai/settings';
import { providerRequest } from '@/lib/ai/http';
import { findCli, runProcess, codexModels } from '@/lib/ai/cli';
import os from 'os';

export async function GET(request: Request) {
  if (!await getServerSession()) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const provider = new URL(request.url).searchParams.get('provider');
  if (!isProvider(provider)) return Response.json({ error: 'Provider tidak valid.' }, { status: 400 });
  try {
    const connection = getConnection(provider);
    let models: { id: string; name: string }[] = [];
    if (['gemini','ollama','custom'].includes(provider)) {
      if (!connection.endpoint) throw new Error('Simpan endpoint API terlebih dahulu.');
      const data = await providerRequest(connection.endpoint.replace(/\/$/,'') + '/models', connection.apiKey ? {Authorization:'Bearer ' + connection.apiKey} : {}, undefined, request.signal);
      models = ((data.data ?? []) as {id:string}[]).filter(item=>typeof item.id==='string').map(item=>({id:item.id,name:item.id}));
    } else if (provider === 'openai' || provider === 'claude') {
      if (!connection.apiKey) throw new Error('Simpan API key terlebih dahulu.');
      const data = await providerRequest(provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models', provider === 'openai'
        ? { Authorization: `Bearer ${connection.apiKey}` } : { 'x-api-key': connection.apiKey, 'anthropic-version': '2023-06-01' }, undefined, request.signal);
      models = ((data.data ?? []) as { id: string; display_name?: string }[]).filter(item => provider === 'claude' || /^(gpt-|o[134]|chatgpt-)/.test(item.id)).map(item => ({ id: item.id, name: item.display_name || item.id }));
    } else {
      if (!canUseLocalCli()) throw new Error('CLI tersedia pada desktop atau development lokal.');
      const executable = findCli(provider, connection.cliPath);
      if (!executable) throw new Error('CLI tidak ditemukan.');
      if (provider === 'codex') return Response.json({ models: await codexModels(executable, request.signal) });
      const credential = connection.apiKey ? { name: (provider === 'kiro' ? 'KIRO_API_KEY' : 'GEMINI_API_KEY') as 'KIRO_API_KEY' | 'GEMINI_API_KEY', value: connection.apiKey } : undefined;
      const output = await runProcess(executable, provider === 'kiro' ? ['chat', '--list-models', '--format', 'json'] : ['models'], os.tmpdir(), '', request.signal, 20000, credential);
      if (provider === 'kiro') {
        const parsed = JSON.parse(output);
        const list = Array.isArray(parsed) ? parsed : parsed.models ?? parsed.data ?? [];
        models = list.map((item: string | { id?: string; modelId?: string; model_id?: string; model_name?: string; name?: string }) => typeof item === 'string' ? { id: item, name: item } : { id: item.id || item.modelId || item.model_id || item.name || '', name: item.model_name || item.name || item.id || item.modelId || item.model_id || '' }).filter((item: { id: string }) => item.id);
      } else {
        models = output.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(id => /^(gemini|claude|gpt)-[a-zA-Z0-9.-]+$/.test(id)).map(id => ({ id, name: id }));
      }
    }
    return Response.json({ models: models.slice(0, 250) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Tidak dapat membaca model.' }, { status: 502 });
  }
}
