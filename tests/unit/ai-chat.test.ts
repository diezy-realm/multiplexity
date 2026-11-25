import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
vi.mock('@/server/auth/session', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/ai/completion', () => ({ complete: vi.fn(async () => 'Synthetic analysis') }));
vi.mock('@/lib/ssh/ssh-manager', () => ({ getSSHManager: () => ({ executeCommand: execute }) }));
const { execute } = vi.hoisted(() => ({ execute: vi.fn(async () => 'service failed password=synthetic-secret') }));
import { getServerSession } from '@/server/auth/session';
import { getDb, closeDb } from '@/lib/db';
import { complete } from '@/lib/ai/completion';
import { GET, POST, DELETE } from '@/server/routes/ai/chat/route';
import { POST as cancel } from '@/server/routes/ai/chat/cancel/route';
import { GET as getPreference, PUT } from '@/server/routes/preferences/route';
import { logCommand, validateSource, redactSecrets } from '@/lib/ai/context';

let directory: string;
const source = { vmId: 'vm-test', kind: 'systemd', target: 'test.service', label: 'Synthetic source' };
const payload = { provider: 'openai', model: 'gpt-4o-mini', effort: 'default', permission: 'read-only', message: 'Diagnose', sources: [], attachments: [] };
function request(body: unknown) { return new Request('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify(body) }); }

beforeEach(() => {
  vi.clearAllMocks(); closeDb();
  directory = mkdtempSync(path.join(os.tmpdir(), 'manager-ai-tests-'));
  vi.stubEnv('DATABASE_PATH', path.join(directory, 'test.db'));
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } });
  execute.mockResolvedValue('service failed password=synthetic-secret');
  vi.mocked(complete).mockResolvedValue('Synthetic analysis');
  getDb().prepare("INSERT INTO vms (id, label, host, username, encrypted_password, encryption_iv, encryption_auth_tag) VALUES ('vm-test', 'Test VM', '127.0.0.1', 'test', '', '', '')").run();
});
afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe('Chat access and context', () => {
  it('forwards clipboard images separately and rejects unsupported CLI transport before inference',async()=>{
    const image={name:'clipboard.png',mediaType:'image/png',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
    expect((await POST(request({...payload,attachments:[image]}))).status).toBe(200);
    expect(vi.mocked(complete).mock.calls[0][8]).toEqual([image]);
    expect(vi.mocked(complete).mock.calls[0][4]).not.toContain(image.content);
    expect(JSON.stringify((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages)).not.toContain(image.content);
    vi.mocked(complete).mockClear();
    expect((await POST(request({...payload,provider:'kiro',attachments:[image]}))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it('requires authentication on history, send, clear and preferences', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/ai/chat"))).status).toBe(401); expect((await DELETE(new Request("http://localhost/api/ai/chat"))).status).toBe(401);
    expect((await POST(request(payload))).status).toBe(401);
    expect((await getPreference(new Request('http://localhost/api/preferences?scope=vm-cards'))).status).toBe(401);
    expect(complete).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('isolates persisted history and card order per account', async () => {
    expect((await POST(request(payload))).status).toBe(200);
    expect((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages).toHaveLength(2);
    expect((await PUT(request({ scope: 'vm-cards', order: ['b', 'a'] }))).status).toBe(200);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-2' } });
    expect((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages).toEqual([]);
    expect((await (await getPreference(new Request('http://localhost/api/preferences?scope=vm-cards'))).json()).order).toEqual([]);
    await DELETE(new Request("http://localhost/api/ai/chat"));
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } });
    expect((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages).toHaveLength(2);
  });
  it('does not read or send logs before explicit approval in Ask mode', async () => {
    expect((await POST(request({ ...payload, sources: [source], permission: 'ask' }))).status).toBe(428);
    expect(execute).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect((await POST(request({ ...payload, sources: [source], permission: 'ask', approved: true }))).status).toBe(200);
    expect(execute).toHaveBeenCalledWith('vm-test', expect.stringContaining("journalctl -u 'test.service'"));
    const context = vi.mocked(complete).mock.calls[0][4];
    expect(context).toContain('[REDACTED]'); expect(context).not.toContain('synthetic-secret');
  });
  it('never persists raw attachments or log context', async () => {
    await POST(request({ ...payload, sources: [source], attachments: [{ name: 'test.log', content: 'attachment-only-data' }] }));
    const history = JSON.stringify((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages);
    expect(history).not.toContain('attachment-only-data'); expect(history).not.toContain('synthetic-secret');
  });
  it('fails without calling the provider when SSH context cannot be read', async () => {
    execute.mockRejectedValueOnce(new Error('Synthetic SSH failure'));
    expect((await POST(request({ ...payload, sources: [source] }))).status).toBe(502);
    expect(complete).not.toHaveBeenCalled();
    expect((await POST(request(payload))).status).toBe(200);
  });
  it.each([
    { ...payload, permission: 'full' },
    { ...payload, model: 'model; shutdown' },
    { ...payload, sources: [{ ...source, target: "test'; uname; '" }] },
    { ...payload, attachments: [{ name: '.env.local', content: 'sensitive' }] },
    { ...payload, attachments: [{ name: 'config.json', content: '{}' }] },
    { ...payload, diagnostic: 'arbitrary-shell' },
  ])('rejects unsupported permissions and unsafe input', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('limits payload size and rejects duplicate card IDs', async () => {
    expect((await POST(request({ ...payload, message: 'x'.repeat(12000001) }))).status).toBe(413);
    expect((await PUT(request({ scope: 'vm-cards', order: ['a', 'a'] }))).status).toBe(400);
  });
  it('cancels the provider operation and does not persist a partial reply', async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(complete).mockImplementationOnce(async (_provider, _model, _effort, _messages, _context, signal) => {
      started();
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }));
    });
    const pending = POST(request(payload));
    await ready;
    expect((await cancel()).status).toBe(200);
    expect((await pending).status).toBe(502);
    expect((await (await GET(new Request("http://localhost/api/ai/chat"))).json()).messages).toEqual([]);
  });
});

describe('Read-only diagnostics', () => {
  it('streams text before completing and persists only the final response', async()=>{
    vi.mocked(complete).mockImplementationOnce(async(...args)=>{args[9]?.({type:'delta',text:'Synthetic '});args[9]?.({type:'delta',text:'answer'});return 'Synthetic answer';});
    const response=await POST(new Request('http://localhost/api/ai/chat',{method:'POST',headers:{Accept:'text/event-stream'},body:JSON.stringify(payload)}));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const wire=await response.text();expect(wire).toContain('"type":"delta"');expect(wire).toContain('"type":"done"');
    expect((await(await GET(new Request("http://localhost/api/ai/chat"))).json()).messages.map((message:{content:string})=>message.content)).toEqual([payload.message,'Synthetic answer']);
  });
  it('allows only validated log targets', () => {
    expect(validateSource({ ...source, kind: 'file', target: '/var/log/test.log' })).toBe(true);
    expect(validateSource({ ...source, kind: 'file', target: '/var/log/../secret.log' })).toBe(false);
    expect(validateSource({ ...source, kind: 'file', target: '/var/log/config.json' })).toBe(false);
    expect(() => logCommand({ ...source, kind: 'systemd', target: 'foo$(id)' })).toThrow();
  });
  it('redacts common plaintext, JSON and bearer credentials', () => {
    expect(redactSecrets('password=test-value {"api_key":"test-json-value"} Authorization: Bearer test-bearer-value'))
      .not.toMatch(/test-value|test-json-value|test-bearer-value/);
  });
  it('runs only fixed status and resource diagnostics', async () => {
    await POST(request({ ...payload, sources: [source], diagnostic: 'status' }));
    expect(execute).toHaveBeenLastCalledWith('vm-test', expect.stringContaining('systemctl status'));
    await POST(request({ ...payload, sources: [source], diagnostic: 'resources' }));
    expect(execute).toHaveBeenLastCalledWith('vm-test', 'uptime; free -m; df -h /');
  });
  it('includes both log and resource context when both plugins are enabled', async () => {
    await POST(request({ ...payload, sources: [source], diagnostic: 'logs', includeResources: true }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'vm-test', expect.stringContaining('journalctl'));
    expect(execute).toHaveBeenNthCalledWith(2, 'vm-test', 'uptime; free -m; df -h /');
  });
});
