import { getDb } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto/credential-store';
import { API_ENDPOINTS, PROVIDERS, type ProviderId, type Connection } from './catalog';

interface ConnectionRow { provider: ProviderId; model: string; api_key_encrypted: string; api_key_iv: string; api_key_auth_tag: string; cli_path: string; endpoint?: string }

export function getConnection(provider: ProviderId) {
  const row = getDb().prepare('SELECT * FROM ai_connections WHERE provider = ?').get(provider) as ConnectionRow | undefined;
  const definition = PROVIDERS.find(item => item.id === provider)!;
  let apiKey = '';
  if (row?.api_key_encrypted) apiKey = decrypt({ ciphertext: row.api_key_encrypted, iv: row.api_key_iv, authTag: row.api_key_auth_tag });
  return { saved: !!row, provider, model: row?.model ?? definition.defaultModel, apiKey, cliPath: row?.cli_path ?? '', endpoint: row?.endpoint || API_ENDPOINTS[provider] || '' };
}

export function publicConnections(): Connection[] {
  return PROVIDERS.map(definition => {
    try {
      const connection = getConnection(definition.id);
      return { provider: definition.id, model: connection.model, configured: !!connection.cliPath || !!connection.apiKey || (definition.id === 'ollama' && connection.saved) || (definition.id === 'custom' && !!connection.endpoint),
        apiKeyHint: connection.apiKey ? '••••' + connection.apiKey.slice(-4) : '', cliPath: connection.cliPath, endpoint: connection.endpoint };
    } catch {
      return { provider: definition.id, model: '', configured: false, apiKeyHint: 'Key tidak dapat dibuka', cliPath: '' };
    }
  });
}

export function saveConnection(provider: ProviderId, model: string, apiKey: string, cliPath: string, clearKey = false, endpoint = '') {
  const existing = getDb().prepare('SELECT * FROM ai_connections WHERE provider = ?').get(provider) as ConnectionRow | undefined;
  const secret = apiKey ? encrypt(apiKey) : { ciphertext: clearKey ? '' : existing?.api_key_encrypted ?? '', iv: clearKey ? '' : existing?.api_key_iv ?? '', authTag: clearKey ? '' : existing?.api_key_auth_tag ?? '' };
  getDb().transaction(() => {
    getDb().prepare(`INSERT INTO ai_connections (provider, model, api_key_encrypted, api_key_iv, api_key_auth_tag, cli_path)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET model=excluded.model,
      api_key_encrypted=excluded.api_key_encrypted, api_key_iv=excluded.api_key_iv,
      api_key_auth_tag=excluded.api_key_auth_tag, cli_path=excluded.cli_path, updated_at=CURRENT_TIMESTAMP`)
      .run(provider, model, secret.ciphertext, secret.iv, secret.authTag, cliPath);
    getDb().prepare('UPDATE ai_connections SET endpoint = ? WHERE provider = ?').run(endpoint, provider);
    getDb().prepare(`INSERT INTO ai_settings (id, provider, model) VALUES ('default', ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, model=excluded.model, updated_at=CURRENT_TIMESTAMP`).run(provider, model);
  })();
}

export function activeProvider(): ProviderId {
  const row = getDb().prepare("SELECT provider FROM ai_settings WHERE id = 'default'").get() as { provider: ProviderId } | undefined;
  return PROVIDERS.some(item => item.id === row?.provider) ? row!.provider : 'openai';
}
