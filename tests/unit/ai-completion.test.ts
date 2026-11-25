import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/ai/settings', () => ({ getConnection: vi.fn(() => ({ model: 'gpt-4o-mini', apiKey: 'synthetic-key', cliPath: '' })) }));
vi.mock('@/lib/ai/http', () => ({ providerRequest: vi.fn() }));
vi.mock('@/lib/ai/cli', () => ({ findCli: vi.fn(() => 'synthetic-cli'), runCli: vi.fn(async () => 'CLI response') }));
vi.mock('@/lib/ai/workspace', () => ({ workspaceInstructions: () => '' }));
vi.mock('@/lib/ai/workspace-tools', () => ({
  workspaceTools: [{ name:'read_artifact', description:'Read', parameters:{} }, { name:'write_artifact', description:'Write', parameters:{} }],
  executeWorkspaceTool: vi.fn(() => 'synthetic-tool-result'),
}));
import { complete } from '@/lib/ai/completion';
import { providerRequest } from '@/lib/ai/http';
import { runCli } from '@/lib/ai/cli';
import { executeWorkspaceTool } from '@/lib/ai/workspace-tools';

beforeEach(() => vi.clearAllMocks());

it('encodes actual image blocks for OpenAI and Claude instead of text-only attachments', async()=>{
 const images=[{name:'clipboard.png',mediaType:'image/png',content:'synthetic-base64'}];
 vi.mocked(providerRequest).mockResolvedValue({output:[{content:[{type:'output_text',text:'Seen'}]}]});
 await complete('openai','gpt-4o-mini','default',[{role:'user',content:'Read screenshot'}],'',undefined,'read-only','user-a',images);
 expect(vi.mocked(providerRequest).mock.calls[0][2]).toMatchObject({input:[{role:'user',content:expect.arrayContaining([{type:'input_image',image_url:'data:image/png;base64,synthetic-base64'}])}]});
 vi.mocked(providerRequest).mockClear().mockResolvedValue({content:[{type:'text',text:'Seen'}]});
 await complete('claude','vision-model','default',[{role:'user',content:'Read screenshot'}],'',undefined,'read-only','user-a',images);
 expect(vi.mocked(providerRequest).mock.calls[0][2]).toMatchObject({messages:[{role:'user',content:expect.arrayContaining([{type:'image',source:{type:'base64',media_type:'image/png',data:'synthetic-base64'}}])}]});
});

it('sends vision messages through an OpenAI-compatible provider and rejects unsupported CLI images',async()=>{
 vi.mocked(providerRequest).mockResolvedValue({choices:[{message:{content:'Vision response'}}]});
 expect(await complete('ollama','vision-model','default',[{role:'user',content:'Read screenshot'}],'',undefined,'read-only','user-a',[{name:'x.png',mediaType:'image/png',content:'abc'}])).toBe('Vision response');
 expect(vi.mocked(providerRequest).mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
 await expect(complete('kiro','','default',[{role:'user',content:'image'}],'',undefined,'read-only','user-a',[{name:'x.png',mediaType:'image/png',content:'abc'}])).rejects.toThrow('belum mendukung');
});

it('keeps untrusted log context out of system instructions and avoids unsupported effort', async () => {
  vi.mocked(providerRequest).mockResolvedValue({ output: [{ content: [{ type: 'output_text', text: 'analysis' }] }] });
  expect(await complete('openai', 'gpt-4o-mini', 'high', [{ role: 'user', content: 'Question' }], 'untrusted-log-fixture')).toBe('analysis');
  const body = vi.mocked(providerRequest).mock.calls[0][2] as { instructions: string; input: { content: string }[]; reasoning?: object; store: boolean };
  expect(body.instructions).not.toContain('untrusted-log-fixture');
  expect(body.input[0].content).toContain('untrusted-log-fixture');
  expect(body.reasoning).toBeUndefined(); expect(body.store).toBe(false);
});

it('uses the requested effort for a supported OpenAI model', async () => {
  vi.mocked(providerRequest).mockResolvedValue({ output: [{ content: [{ type: 'output_text', text: 'analysis' }] }] });
  await complete('openai', 'gpt-5', 'high', [{ role: 'user', content: 'Question' }], '');
  expect(vi.mocked(providerRequest).mock.calls[0][2]).toMatchObject({ reasoning: { effort: 'high' } });
});

it('uses Claude API authentication without consumer OAuth tokens', async () => {
  vi.mocked(providerRequest).mockResolvedValue({ content: [{ type: 'text', text: 'Claude response' }] });
  expect(await complete('claude', 'synthetic-model', 'default', [{ role: 'user', content: 'Question' }], '')).toBe('Claude response');
  expect(vi.mocked(providerRequest).mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  expect(vi.mocked(providerRequest).mock.calls[0][1]).toHaveProperty('x-api-key');
});

it('does not run a native CLI on the web server', async () => {
  vi.stubEnv('DESKTOP_MODE', '');
  try {
    await expect(complete('codex', '', 'default', [{ role: 'user', content: 'Question' }], '')).rejects.toThrow('desktop');
    expect(runCli).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});

it('completes an OpenAI tool round trip without exposing write tools in read-only mode', async () => {
  vi.mocked(providerRequest).mockResolvedValueOnce({output:[{type:'function_call',name:'read_artifact',arguments:'{"name":"rules.md"}',call_id:'call-a'}]})
    .mockResolvedValueOnce({output:[{content:[{type:'output_text',text:'Grounded analysis'}]}]});
  expect(await complete('openai','gpt-4o-mini','default',[{role:'user',content:'Read rules'}],'',undefined,'read-only','user-a')).toBe('Grounded analysis');
  expect(executeWorkspaceTool).toHaveBeenCalledWith('user-a','read-only','read_artifact',{name:'rules.md'});
  const body=vi.mocked(providerRequest).mock.calls[1][2] as {input:unknown[];tools:{name:string}[]};
  expect(body.input).toContainEqual({type:'function_call_output',call_id:'call-a',output:'synthetic-tool-result'});
  expect(body.tools.some(tool=>tool.name==='write_artifact')).toBe(false);
});

it('completes a Claude artifact write round trip when Allow All is selected', async () => {
  vi.mocked(providerRequest).mockResolvedValueOnce({content:[{type:'tool_use',id:'tool-a',name:'write_artifact',input:{name:'artifacts/output.md',content:'Output'}}]})
    .mockResolvedValueOnce({content:[{type:'text',text:'Saved'}]});
  expect(await complete('claude','synthetic-model','default',[{role:'user',content:'Save output'}],'',undefined,'allow-all','user-a')).toBe('Saved');
  expect(executeWorkspaceTool).toHaveBeenCalledWith('user-a','allow-all','write_artifact',{name:'artifacts/output.md',content:'Output'});
  expect(vi.mocked(providerRequest).mock.calls[1][2]).toMatchObject({messages:expect.arrayContaining([{role:'user',content:[{type:'tool_result',tool_use_id:'tool-a',content:'synthetic-tool-result'}]}])});
});
