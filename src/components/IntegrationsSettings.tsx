'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plug, Power, Server, Trash2, XCircle } from 'lucide-react';
import Select from '@/components/Select';

type ConnectorKind = 'bamboo' | 'sonarqube' | 'jira' | 'bitbucket' | 'ghes' | 'checkmarx' | 'confluent';

interface Connector {
  id: string;
  kind: ConnectorKind;
  label: string;
  baseUrl: string;
  enabled: boolean;
  hasToken: boolean;
  lastStatus: string;
  lastVersion: string;
}

interface McpServer {
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  target: string;
  lastStatus: string;
  tools: { name: string; description?: string }[];
}

export default function IntegrationsSettings() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [kind, setKind] = useState<ConnectorKind>('bamboo');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [insecureTls, setInsecureTls] = useState(false);

  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLabel, setMcpLabel] = useState('');
  const [mcpTransport, setMcpTransport] = useState<'http' | 'stdio'>('http');
  const [mcpTarget, setMcpTarget] = useState('');
  const [mcpToken, setMcpToken] = useState('');

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cRes, mRes] = await Promise.all([fetch('/api/connectors'), fetch('/api/mcp')]);
    if (cRes.ok) {
      const data = await cRes.json();
      setConnectors(data.connectors || []);
    }
    if (mRes.ok) {
      const data = await mRes.json();
      setMcpServers(data.servers || []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveConnector(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, label, baseUrl, token, insecureTls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan konektor.');
      setLabel('');
      setBaseUrl('');
      setToken('');
      setMessage('Konektor tersimpan terenkripsi.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menyimpan konektor.');
    } finally {
      setBusy(false);
    }
  }

  async function testConn(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Uji koneksi gagal.');
      setMessage(`${data.message}${data.version ? ` (v${data.version})` : ''}`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Uji koneksi gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(conn: Connector) {
    setBusy(true);
    try {
      await fetch(`/api/connectors/${encodeURIComponent(conn.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !conn.enabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveMcp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: mcpLabel, transport: mcpTransport, target: mcpTarget, token: mcpToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan MCP.');
      setMcpLabel('');
      setMcpTarget('');
      setMcpToken('');
      setMessage('Server MCP read-only tersimpan.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menyimpan MCP.');
    } finally {
      setBusy(false);
    }
  }

  async function probeMcp(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/mcp/${encodeURIComponent(id)}/probe`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Probe MCP gagal.');
      setMessage(`MCP ${data.status} (${(data.tools || []).length} tools)`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Probe MCP gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMcp(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 text-xs">
      <form onSubmit={(e) => void saveConnector(e)} className="rounded-xl border border-[var(--ui-border)] p-3 space-y-2.5">
        <div className="font-semibold">Konektor Enterprise (Token Terenkripsi Lokal)</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            Jenis
            <Select value={kind} onChange={(e) => setKind(e.target.value as ConnectorKind)} aria-label="Jenis konektor">
              <option value="bamboo">Bamboo Data Center</option>
              <option value="sonarqube">SonarQube Server</option>
              <option value="jira">Jira Data Center</option>
              <option value="bitbucket">Bitbucket Data Center</option>
              <option value="ghes">GitHub Enterprise Server</option>
              <option value="checkmarx">Checkmarx / SCA</option>
              <option value="confluent">Confluent Metadata</option>
            </Select>
          </label>
          <label className="block">
            Label
            <input className="ui-field w-full mt-1" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bamboo Pilot" />
          </label>
        </div>
        <label className="block">
          Base URL
          <input className="ui-field w-full mt-1 font-mono" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host.internal" />
        </label>
        <label className="block">
          Token Akses
          <input className="ui-field w-full mt-1 font-mono" type="password" required value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={insecureTls} onChange={(e) => setInsecureTls(e.target.checked)} />
          <span>Izinkan sertifikat TLS lab/internal</span>
        </label>
        <div>
          <button type="submit" className="ui-button" disabled={busy}>Simpan Konektor</button>
        </div>
      </form>

      {message && <p role="status" className="opacity-85">{message}</p>}

      <div className="space-y-2">
        {connectors.map((c) => (
          <div key={c.id} className="rounded-xl border border-[var(--ui-border)] p-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <Plug size={13} aria-hidden="true" />
                <span>{c.label}</span>
                <span className="opacity-65">({c.kind})</span>
                {c.lastStatus === 'ok' && <CheckCircle2 size={13} className="text-emerald-500" aria-hidden="true" />}
                {(c.lastStatus === 'error' || c.lastStatus === 'denied') && <XCircle size={13} className="text-red-500" aria-hidden="true" />}
              </div>
              <div className="font-mono opacity-70 mt-0.5">{c.baseUrl}</div>
              <div className="opacity-70 mt-0.5">
                {c.enabled ? 'Aktif' : 'Nonaktif'} · {c.lastStatus}{c.lastVersion ? ` · v${c.lastVersion}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="ui-button" disabled={busy || !c.enabled} onClick={() => void testConn(c.id)}>Uji</button>
              <button type="button" className="icon-action" aria-label={c.enabled ? 'Nonaktifkan konektor' : 'Aktifkan konektor'} onClick={() => void toggle(c)}>
                <Power size={14} aria-hidden="true" />
              </button>
              <button type="button" className="icon-action" aria-label="Hapus konektor" onClick={() => void remove(c.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => void saveMcp(e)} className="rounded-xl border border-[var(--ui-border)] p-3 space-y-2.5">
        <div className="font-semibold">MCP Read-Only Server (Ekstensi Internal)</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            Label
            <input className="ui-field w-full mt-1" required value={mcpLabel} onChange={(e) => setMcpLabel(e.target.value)} placeholder="SAC Internal MCP" />
          </label>
          <label className="block">
            Transport
            <Select value={mcpTransport} onChange={(e) => setMcpTransport(e.target.value as 'http' | 'stdio')} aria-label="Transport MCP">
              <option value="http">Streamable HTTP</option>
              <option value="stdio">Local stdio</option>
            </Select>
          </label>
        </div>
        <label className="block">
          Endpoint URL / Command
          <input className="ui-field w-full mt-1 font-mono" required value={mcpTarget} onChange={(e) => setMcpTarget(e.target.value)} placeholder="https://mcp.internal/rpc" />
        </label>
        <label className="block">
          Bearer Token (Opsional)
          <input className="ui-field w-full mt-1 font-mono" type="password" value={mcpToken} onChange={(e) => setMcpToken(e.target.value)} />
        </label>
        <button type="submit" className="ui-button" disabled={busy}>Tambah MCP</button>
      </form>

      {mcpServers.length > 0 && (
        <div className="space-y-2">
          {mcpServers.map((m) => (
            <div key={m.id} className="rounded-xl border border-[var(--ui-border)] p-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold flex items-center gap-1.5">
                  <Server size={13} aria-hidden="true" />
                  <span>{m.label}</span>
                  <span className="opacity-65">({m.transport} · read-only)</span>
                </div>
                <div className="font-mono opacity-70">{m.target}</div>
                <div className="opacity-70">Status: {m.lastStatus} · Tools: {m.tools.length}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="ui-button" disabled={busy} onClick={() => void probeMcp(m.id)}>Probe</button>
                <button type="button" className="icon-action" aria-label="Hapus MCP" onClick={() => void removeMcp(m.id)}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
