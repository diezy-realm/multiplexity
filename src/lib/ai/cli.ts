import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { StringDecoder } from 'string_decoder';
import { CliStreamDecoder } from './cli-stream';
import type { CompletionObserver } from './stream-events';
import { type ChatAttachment, type ProviderId, type Effort, type Permission } from './catalog';
import { workspaceRoot } from './workspace';

export { findCli } from './cli-discovery';

export function cliEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
  return { NODE_ENV: 'production', ...Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])) };
}

export function codexModels(executable: string, signal?: AbortSignal): Promise<{ id: string; name: string }[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['app-server'], { cwd: os.tmpdir(), shell: false, windowsHide: true, env: cliEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let done = false;
    const finish = (error?: Error, models: { id: string; name: string }[] = []) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); child.kill();
      if (error) reject(error); else resolve(models);
    };
    const abort = () => finish(new Error('Permintaan dibatalkan.'));
    const timer = setTimeout(() => finish(new Error('Daftar model Codex timeout. Periksa login CLI.')), 20000);
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.on('error', () => finish(new Error('Codex app-server tidak dapat dijalankan.')));
    child.on('close', () => { if (!done) finish(new Error('Codex app-server berhenti sebelum daftar model tersedia.')); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024) { finish(new Error('Respons model terlalu besar.')); return; }
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            if (message.error) { finish(new Error('Inisialisasi Codex gagal. Periksa versi CLI.')); return; }
            send({ method: 'initialized' }); send({ id: 2, method: 'model/list', params: { includeHidden: false } });
          }
          if (message.id === 2) {
            if (message.error) { finish(new Error('Daftar model Codex tidak tersedia. Periksa login dan izin akun.')); return; }
            const data = message.result?.data;
            if (!Array.isArray(data)) { finish(new Error('Format daftar model Codex tidak dikenali.')); return; }
            finish(undefined, data.map((item: { id: string; model?: string; displayName?: string }) => ({ id: item.model || item.id, name: item.displayName || item.model || item.id })));
          }
        } catch { /* Ignore non-protocol startup messages. */ }
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'manager_system_internal', version: '0.1.3' }, capabilities: { experimentalApi: false } } });
  });
}

export function runProcess(executable: string, args: string[], cwd: string, input: string, signal?: AbortSignal, timeoutMs = 120000, credential?: { name: 'KIRO_API_KEY' | 'GEMINI_API_KEY'; value: string }, captureHelp = false, onStdout?:(text:string)=>void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Permintaan dibatalkan.')); return; }
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: { ...cliEnvironment(), ...(credential ? { [credential.name]: credential.value } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const decoder = new StringDecoder('utf8');
    let diagnostic = '';
    let failure: Error | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill();
    };
    const abort = () => stop(new Error('Permintaan dibatalkan.'));
    const timer = setTimeout(() => stop(new Error('CLI timeout.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { const text=decoder.write(chunk); output += text; onStdout?.(text); if (Buffer.byteLength(output) > 2 * 1024 * 1024) stop(new Error('Output CLI terlalu besar.')); });
    child.stderr.on('data', chunk => {
      diagnostic = (diagnostic + chunk.toString()).slice(-8000);
      if (captureHelp) { output += chunk.toString(); if (Buffer.byteLength(output) > 2 * 1024 * 1024) stop(new Error('Output bantuan terlalu besar.')); }
    });
    child.stdin.on('error', () => {});
    child.on('error', () => { failure = new Error('CLI tidak dapat dijalankan. Periksa path executable.'); });
    child.on('close', code => {
      const remainder=decoder.end();output+=remainder;if(remainder)onStdout?.(remainder);
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) {
        // eslint-disable-next-line no-control-regex -- Strip CLI terminal escape sequences.
        const detail = diagnostic.replace(/\x1b\[[0-9;]*m/g,'').replace(/https?:\/\/[^\s]+/g,'[URL]').replace(/(Bearer\s+|(?:token|key|password|secret)\s*[=:]\s*)\S+/gi,'$1[REDACTED]').split('\n').find(line=>/error|invalid|failed|unsupported|not found|login|auth/i.test(line))?.slice(0,350);
        reject(new Error(`CLI gagal (exit ${code}). ${detail || 'Periksa login CLI, versi, model, dan dukungan flag.'}`));
      }
      else resolve(output);
    });
    if (signal?.aborted) abort();
    child.stdin.end(input);
  });
}

export async function runCli(provider: ProviderId, executable: string, model: string, effort: Effort, prompt: string, signal?: AbortSignal, apiKey = '', permission: Permission = 'read-only', userId = 'default', images: ChatAttachment[] = [], observe?:CompletionObserver): Promise<string> {
  const cwd = workspaceRoot(userId);
  const allowAll = permission === 'allow-all';
  let generatedFile: string | undefined;
  const imageFiles: string[] = [];
  try {
    let args: string[];
    if (provider === 'codex') {
      args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json'];
      args.push(...(allowAll ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', 'read-only', '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false', '-c', 'features.apply_patch_tool=false', '-c', 'web_search="disabled"']));
      for (const image of images) { const file=path.join(os.tmpdir(),'multiplexity-image-' + randomUUID() + (image.mediaType==='image/png'?'.png':image.mediaType==='image/jpeg'?'.jpg':'.webp'));imageFiles.push(file);fs.writeFileSync(file,Buffer.from(image.content,'base64'),{mode:0o600});args.push('--image',file); }
      if (effort !== 'default') args.push('-c', `model_reasoning_effort="${effort}"`);
    } else if (provider === 'kiro') {
      const agentDirectory = path.join(cwd, '.kiro', 'agents');
      fs.mkdirSync(agentDirectory, { recursive: true });
      const agentName = `manager-chat-${randomUUID().slice(0,8)}`;
      generatedFile = path.join(agentDirectory, `${agentName}.json`);
      fs.writeFileSync(generatedFile, JSON.stringify({
        name: agentName, description: 'Manager shared workspace', tools: allowAll ? ['@builtin'] : [], resources: [], mcpServers: {},
        includeMcpJson: false, includePowers: false, hooks: {}, permissions: { rules: [] },
        prompt: 'Read AGENTS.md, rules.md, steering.md and applicable skills. Save deliverables under artifacts/. Never claim an action without execution evidence.',
      }));
      args = ['chat', '--v3', '--no-interactive', '--agent', agentName, allowAll ? '--trust-all-tools' : '--trust-tools=', '--output-format', 'text'];
      if (effort !== 'default') args.push('--effort', effort);
    } else {
      const help = await runProcess(executable, ['--help'], cwd, '', signal, 15000, undefined, true);
      if (!help.includes('--settings')) throw new Error('Versi Antigravity ini belum menyediakan --settings untuk membatasi izin tool. Koneksi Chat dinonaktifkan.');
      const runtime = path.join(cwd,'.runtime'); fs.mkdirSync(runtime,{recursive:true});
      const policy = path.join(runtime,`agy-policy-${randomUUID()}.json`); generatedFile = policy;
      fs.writeFileSync(policy, JSON.stringify({ toolPermission: allowAll ? 'always-proceed' : 'strict', ...(apiKey ? { modelProvider: 'gemini' } : {}) }));
      // Strict headless policy denies tool actions requiring interactive approval.
      args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands'];
      args.push(...(allowAll ? ['--dangerously-skip-permissions'] : ['--mode', 'plan', '--sandbox']));
      args.push('--settings', policy);
      if (effort !== 'default') args.push('--effort', effort);
    }
    if (model) args.push('--model', model);
    const input = provider === 'antigravity' ? JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n' : prompt;
    const credential = apiKey && provider !== 'codex' ? { name: (provider === 'kiro' ? 'KIRO_API_KEY' : 'GEMINI_API_KEY') as 'KIRO_API_KEY' | 'GEMINI_API_KEY', value: apiKey } : undefined;
    observe?.({type:'status',stage:provider==='kiro'?'buffered':'thinking'});
    const stream = observe && provider!=='kiro' ? new CliStreamDecoder(provider,observe) : undefined;
    const output = await runProcess(executable, args, cwd, input, signal, 120000, credential, false, stream ? text=>stream.push(text) : undefined);
    stream?.finish();
    if (provider === 'codex') {
      const messages = output.split('\n').flatMap(line => {
        try { const event = JSON.parse(line); return event.type === 'item.completed' && event.item?.type === 'agent_message' ? [event.item.text as string] : []; } catch { return []; }
      });
      if (!messages.length) throw new Error('Codex tidak memberikan respons teks. Periksa login dan versi CLI.');
      return messages.join('\n\n');
    }
    if (provider === 'antigravity') {
      let text = '';
      for (const line of output.split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.event === 'result' && event.result?.status === 'SUCCESS') text = event.result.response;
        } catch { /* Ignore non-protocol output. */ }
      }
      if (!text) throw new Error('Antigravity tidak memberikan hasil. Periksa login dan kebijakan CLI.');
      return text;
    }
    // eslint-disable-next-line no-control-regex -- Strip CLI terminal escape sequences.
    return output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  } finally { if (generatedFile) fs.rmSync(generatedFile,{force:true}); for(const file of imageFiles) fs.unlinkSync(file); }
}
