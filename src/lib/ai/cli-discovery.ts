import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { ProviderId } from './catalog';

const commands: Partial<Record<ProviderId, string>> = { codex: 'codex', kiro: 'kiro-cli', antigravity: 'agy' };
const state = globalThis as typeof globalThis & { managerCliWindowsPath?: { at: number; paths: string[] } };

function expandPath(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1').replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
}

export function windowsSearchPath(refresh = false): string[] {
  if (process.platform !== 'win32') return [];
  if (!refresh && state.managerCliWindowsPath && Date.now() - state.managerCliWindowsPath.at < 5000) return state.managerCliWindowsPath.paths;
  let paths: string[] = [];
  try {
    // Read only persisted PATH, so installations made after app startup are visible.
    const script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); [ordered]@{user=[Environment]::GetEnvironmentVariable('Path','User');machine=[Environment]::GetEnvironmentVariable('Path','Machine')} | ConvertTo-Json -Compress";
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const output = execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 256000, stdio: ['ignore', 'pipe', 'ignore'] });
    const values = JSON.parse(output.replace(/^\uFEFF/, ''));
    paths = [values.user, values.machine].filter((value): value is string => typeof value === 'string').flatMap(value => value.split(';'));
  } catch { /* Known installation locations remain available if registry access fails. */ }
  state.managerCliWindowsPath = { at: Date.now(), paths };
  return paths;
}

function nativeFile(candidate: string, expected: string): string | null {
  if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== expected.toLowerCase()) return null;
  try { return fs.statSync(candidate).isFile() ? candidate : null; } catch { return null; }
}

export function resolveConfiguredCli(provider: ProviderId, value: string): string | null {
  const command = commands[provider];
  if (!command) return null;
  const expected = process.platform === 'win32' ? `${command}.exe` : command;
  let candidate = expandPath(value);
  if (!path.isAbsolute(candidate)) return null;
  try { if (fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, expected); } catch { /* A stale executable may be replaced by automatic discovery. */ }
  return nativeFile(candidate, expected);
}

export function findCli(provider: ProviderId, configuredPath = ''): string | null {
  const command = commands[provider];
  if (!command) return null;
  const expected = process.platform === 'win32' ? `${command}.exe` : command;
  if (configuredPath) {
    const resolved = resolveConfiguredCli(provider, configuredPath);
    if (resolved) return resolved;
    const configured = expandPath(configuredPath);
    if (!path.isAbsolute(configured) || (/\.exe$/i.test(configured) && path.basename(configured).toLowerCase() !== expected.toLowerCase())) return null;
  }
  const folders: string[] = windowsSearchPath().map(expandPath);
  const local = process.env.LOCALAPPDATA;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (local && process.platform === 'win32') {
    const known: Partial<Record<ProviderId, string[]>> = {
      codex: [path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin')],
      kiro: [path.join(local, 'Kiro-Cli'), path.join(local, 'Programs', 'Kiro CLI', 'bin')],
      antigravity: [path.join(local, 'agy', 'bin'), path.join(local, 'Programs', 'Antigravity', 'bin'), path.join(local, 'Programs', 'Google', 'Antigravity', 'bin'), path.join(local, 'Programs', 'agy', 'bin')],
    };
    folders.unshift(...(known[provider] ?? []));
  }
  if (home) folders.push(path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'));
  folders.push(...(process.env.PATH ?? '').split(path.delimiter).map(expandPath));
  if (local && process.platform === 'win32') folders.push(path.join(local, 'Microsoft', 'WindowsApps'));
  if (provider === 'codex' && process.platform === 'win32') {
    const npmRoots = [process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'), path.join(path.dirname(process.execPath), 'node_modules')].filter((value): value is string => !!value);
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    for (const root of npmRoots) {
      const optional = `codex-win32-${process.arch}`;
      for (const base of [path.join(root, '@openai', 'codex'), path.join(root, '@openai', optional), path.join(root, '@openai', 'codex', 'node_modules', '@openai', optional)]) {
        folders.push(path.join(base, 'vendor', `${arch}-pc-windows-msvc`, 'codex'));
      }
    }
  }
  const visited = new Set<string>();
  for (const folder of folders.filter(Boolean)) {
    const candidate = path.join(folder, expected);
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (visited.has(key)) continue;
    visited.add(key);
    const found = nativeFile(candidate, expected);
    if (found) return found;
  }
  return null;
}
