import { afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { cliEnvironment, findCli, runProcess } from '@/lib/ai/cli';

afterEach(() => vi.unstubAllEnvs());

it('does not forward application secrets or arbitrary environment variables to CLI processes', () => {
  vi.stubEnv('ENCRYPTION_KEY', 'synthetic-secret'); vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-secret');
  vi.stubEnv('DESKTOP_ACCESS_TOKEN', 'synthetic-token'); vi.stubEnv('DATABASE_PATH', 'synthetic-path');
  const env = cliEnvironment();
  for (const key of ['ENCRYPTION_KEY', 'NEXTAUTH_SECRET', 'DESKTOP_ACCESS_TOKEN', 'DATABASE_PATH']) expect(env[key]).toBeUndefined();
});

it('accepts only the selected provider executable name', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'manager-cli-test-'));
  try {
    const filename = path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    writeFileSync(filename, 'fixture');
    expect(findCli('codex', filename)).toBe(filename); expect(findCli('kiro', filename)).toBeNull();
    expect(findCli('codex', 'relative/codex.exe')).toBeNull();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('sends untrusted prompt content through stdin without a shell', async () => {
  const input = 'synthetic prompt; $(not-a-command) & echo ignored';
  const output = await runProcess(process.execPath, ['-e', "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s))"], os.tmpdir(), input);
  expect(output).toBe(input);
});

it('terminates a hung CLI request', async () => {
  await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], os.tmpdir(), '', undefined, 100)).rejects.toThrow('timeout');
}, 15000);
