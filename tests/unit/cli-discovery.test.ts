import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
vi.mock('child_process', async importOriginal => ({ ...await importOriginal<typeof import('child_process')>(), execFileSync: vi.fn(() => '{"user":"","machine":""}') }));
import { execFileSync } from 'child_process';
import { findCli, resolveConfiguredCli, windowsSearchPath } from '@/lib/ai/cli-discovery';

let directory: string;
function binary(folder: string, name = 'codex') {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, process.platform === 'win32' ? `${name}.exe` : name);
  writeFileSync(file, 'synthetic executable'); return file;
}
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'manager-discovery-'));
  vi.stubEnv('LOCALAPPDATA', path.join(directory, 'local'));
  vi.stubEnv('APPDATA', path.join(directory, 'roaming'));
  vi.stubEnv('USERPROFILE', path.join(directory, 'home'));
  vi.stubEnv('HOME', path.join(directory, 'home'));
  vi.stubEnv('PATH', '');
  vi.mocked(execFileSync).mockReturnValue('{"user":"","machine":""}');
  windowsSearchPath(true);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it('finds a standalone Codex installation when the app PATH is stale', () => {
  const executable = binary(path.join(directory, 'local', 'Programs', 'OpenAI', 'Codex', 'bin'));
  expect(findCli('codex')).toBe(executable);
});
it('accepts a bin directory and quoted executable path', () => {
  const folder = path.join(directory, 'custom bin'); const executable = binary(folder);
  expect(resolveConfiguredCli('codex', folder)).toBe(executable);
  expect(resolveConfiguredCli('codex', `"${executable}"`)).toBe(executable);
  expect(resolveConfiguredCli('kiro', executable)).toBeNull();
});
it('expands Windows environment variables without evaluating shell expressions', () => {
  const executable = binary(path.join(directory, 'local', 'Programs', 'OpenAI', 'Codex', 'bin'));
  expect(resolveConfiguredCli('codex', '%LOCALAPPDATA%/Programs/OpenAI/Codex/bin')).toBe(executable);
});
it('refreshes the persisted user PATH after a new installation', () => {
  const folder = path.join(directory, 'new-cli'); const executable = binary(folder, 'kiro-cli');
  vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ user: folder, machine: '' }));
  windowsSearchPath(true);
  expect(findCli('kiro')).toBe(executable);
});
it('recovers from a stale saved Codex executable after an update', () => {
  const executable = binary(path.join(directory, 'local', 'Programs', 'OpenAI', 'Codex', 'bin'));
  expect(findCli('codex', path.join(directory, 'old', 'codex.exe'))).toBe(executable);
});
it('rejects directories named like executables and files for another provider', () => {
  const folder = path.join(directory, 'codex.exe'); mkdirSync(folder);
  expect(resolveConfiguredCli('codex', folder)).toBeNull();
  expect(findCli('codex', binary(path.join(directory, 'other'), 'kiro-cli'))).toBeNull();
});
