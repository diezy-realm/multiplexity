import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
vi.mock('@/server/auth/session', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'test' } })) }));
import { getDb, closeDb } from '@/lib/db';
import { getConnection, publicConnections, saveConnection } from '@/lib/ai/settings';
import { POST, DELETE } from '@/server/routes/ai/settings/route';
import { encrypt } from '@/lib/crypto/credential-store';
import { reorderIds } from '@/hooks/useCardOrder';

let directory: string;

it('validates custom endpoints and persists local API configuration without a fake key',async()=>{
 const save=(endpoint:string)=>POST(new Request('http://localhost/api/ai/settings',{method:'POST',body:JSON.stringify({provider:'custom',model:'vision-model',apiKey:'',endpoint})}));
 expect((await save('http://remote.example/v1')).status).toBe(400);
 expect((await save('https://user:password@example.com/v1')).status).toBe(400);
 expect((await save('http://127.0.0.1:11434/v1')).status).toBe(200);
 expect(getConnection('custom').endpoint).toBe('http://127.0.0.1:11434/v1');
 expect((await DELETE(new Request('http://localhost/api/ai/settings',{method:'DELETE',body:JSON.stringify({provider:'custom'})}))).status).toBe(200);
 expect(getConnection('custom').endpoint).toBe('');
});
beforeEach(() => {
  closeDb(); directory = mkdtempSync(path.join(os.tmpdir(), 'manager-ai-settings-'));
  vi.stubEnv('DATABASE_PATH', path.join(directory, 'test.db')); vi.stubEnv('ENCRYPTION_KEY', 'f'.repeat(64));
});
afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it('preserves an encrypted key when saving a different model', async () => {
  saveConnection('openai', 'gpt-4o-mini', 'synthetic-api-key', '');
  const response = await POST(new Request('http://localhost/api/ai/settings', { method: 'POST', body: JSON.stringify({ provider: 'openai', model: 'gpt-4o', apiKey: '' }) }));
  expect(response.status).toBe(200); expect(getConnection('openai').apiKey).toBe('synthetic-api-key');
  expect(getConnection('openai').model).toBe('gpt-4o');
  expect(JSON.stringify(publicConnections())).not.toContain('synthetic-api-key');
  const stored = getDb().prepare("SELECT api_key_encrypted FROM ai_connections WHERE provider = 'openai'").get() as { api_key_encrypted: string };
  expect(stored.api_key_encrypted).not.toBe('synthetic-api-key');
});

it('migrates old OpenAI settings and preserves VM data during an upgrade', () => {
  const db = getDb(); const key = encrypt('legacy-synthetic-key');
  db.prepare("INSERT INTO ai_settings (id, provider, model, api_key_encrypted, api_key_iv, api_key_auth_tag) VALUES ('default', 'openai', 'legacy-model', ?, ?, ?)").run(key.ciphertext, key.iv, key.authTag);
  db.prepare("INSERT INTO vms (id, label, host, username, encrypted_password, encryption_iv, encryption_auth_tag) VALUES ('legacy-vm', 'Legacy', '127.0.0.1', 'test', '', '', '')").run();
  db.exec('DROP TABLE ai_connections; DROP TABLE ui_preferences; DROP TABLE ai_chat_messages;'); closeDb();
  expect(getConnection('openai').apiKey).toBe('legacy-synthetic-key');
  expect(getDb().prepare("SELECT label FROM vms WHERE id = 'legacy-vm'").get()).toEqual({ label: 'Legacy' });
  closeDb(); expect(getConnection('openai').model).toBe('legacy-model');
});

it('removes a key only when explicitly requested', () => {
  saveConnection('kiro', '', 'synthetic-kiro-key', '');
  saveConnection('kiro', '', '', '', true);
  expect(getConnection('kiro').apiKey).toBe('');
});

it('keeps reordering deterministic without mutating the original list', () => {
  const original = ['a', 'b', 'c'];
  expect(reorderIds(original, 'a', 'c')).toEqual(['b', 'c', 'a']);
  expect(original).toEqual(['a', 'b', 'c']);
  expect(reorderIds(original, 'missing', 'a')).toBe(original);
});
