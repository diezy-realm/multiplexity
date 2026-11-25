import { getDb } from '@/lib/db';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import type { LogSource } from './catalog';

export function validateSource(source: unknown): source is LogSource {
  if (!source || typeof source !== 'object') return false;
  const item = source as LogSource;
  if (typeof item.vmId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.vmId) || typeof item.target !== 'string' || item.target.length > 512 || typeof item.label !== 'string' || item.label.length > 200) return false;
  if (item.kind === 'systemd') return /^[a-zA-Z0-9_.@-]+$/.test(item.target) && !item.target.startsWith('-');
  if (item.kind === 'docker') return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(item.target);
  if (item.kind !== 'file') return false;
  return /^\/[a-zA-Z0-9_./@ -]+\.(log|out|err|txt)(\.[0-9]+)?$/.test(item.target) && !item.target.split('/').includes('..');
}

export function logCommand(source: LogSource): string {
  if (!validateSource(source)) throw new Error('Sumber log tidak valid.');
  if (source.kind === 'systemd') return `timeout 12s journalctl -u '${source.target}' -n 150 --no-pager 2>&1 | head -c 24000`;
  if (source.kind === 'docker') return `timeout 12s docker logs --tail 150 '${source.target}' 2>&1 | head -c 24000`;
  return `timeout 12s tail -n 150 -- '${source.target}' 2>&1 | head -c 24000`;
}

export function redactSecrets(text: string): string {
  return text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token|secret)\b(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]{16,}\b/g, '[REDACTED]');
}

export async function readSources(sources: LogSource[], diagnostic: 'logs' | 'status' | 'resources' = 'logs') {
  const results = [];
  for (const source of sources) {
    if (!validateSource(source)) throw new Error('Sumber log tidak valid.');
    const vm = getDb().prepare('SELECT id, label FROM vms WHERE id = ?').get(source.vmId) as { id: string; label: string } | undefined;
    if (!vm) throw new Error('VM sumber log tidak ditemukan.');
    const timestamp = new Date().toISOString();
    const command = diagnostic === 'resources'
      ? 'uptime; free -m; df -h /'
      : diagnostic === 'status'
        ? source.kind === 'systemd'
          ? `timeout 12s systemctl status --no-pager -- '${source.target}' 2>&1 | head -c 12000`
          : source.kind === 'docker'
            ? `timeout 12s docker ps --filter 'name=${source.target}' --format '{{.Names}} {{.Status}}' 2>&1 | head -c 12000`
            : `timeout 12s stat -- '${source.target}' 2>&1 | head -c 12000`
        : logCommand(source);
    const output = await getSSHManager().executeCommand(source.vmId, command);
    results.push({ ...source, label: `${vm.label} · ${diagnostic === 'logs' ? source.target : diagnostic}`, timestamp, content: redactSecrets(output.slice(0, 24000)) });
  }
  return results;
}
