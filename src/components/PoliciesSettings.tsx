'use client';
import { useEffect, useState } from 'react';

export default function PoliciesSettings() {
  const [envs, setEnvs] = useState('dev, development, sit, uat, staging, qa, nonprod, sandbox');
  const [patterns, setPatterns] = useState('');
  const [maxChars, setMaxChars] = useState(32000);
  const [testCommands, setTestCommands] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/policies')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const p = data?.policy;
        if (!p) return;
        if (Array.isArray(p.allowedNonprodEnvs)) setEnvs(p.allowedNonprodEnvs.join(', '));
        if (Array.isArray(p.customRedactionPatterns)) setPatterns(p.customRedactionPatterns.join('\n'));
        if (typeof p.maxAiPayloadChars === 'number') setMaxChars(p.maxAiPayloadChars);
        if (Array.isArray(p.allowedTestCommands)) setTestCommands(p.allowedTestCommands.join('\n'));
      })
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const splitList = (raw: string, sep: RegExp) =>
        raw
          .split(sep)
          .map((s) => s.trim())
          .filter(Boolean);
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedNonprodEnvs: splitList(envs, /[,\n]/),
          customRedactionPatterns: splitList(patterns, /\n/),
          maxAiPayloadChars: maxChars,
          allowedTestCommands: splitList(testCommands, /\n/),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan kebijakan.');
      setMessage('Kebijakan tersimpan.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menyimpan kebijakan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3 text-xs">
      <label className="block">
        Allowlist Environment Non-Produksi (pisahkan koma)
        <input className="ui-field w-full mt-1" value={envs} onChange={(e) => setEnvs(e.target.value)} />
      </label>
      <label className="block">
        Regex Redaksi Kustom (satu per baris)
        <textarea
          className="ui-field w-full mt-1 h-24 font-mono"
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          placeholder="CORP-[0-9]{4,}"
        />
      </label>
      <label className="block">
        Batas Karakter Payload AI
        <input
          type="number"
          min={2000}
          max={100000}
          className="ui-field w-44 mt-1"
          value={maxChars}
          onChange={(e) => setMaxChars(Number(e.target.value) || 32000)}
        />
      </label>
      <label className="block">
        Perintah Test Lokal Diizinkan (satu per baris)
        <textarea
          className="ui-field w-full mt-1 h-20 font-mono"
          value={testCommands}
          onChange={(e) => setTestCommands(e.target.value)}
          placeholder="cargo test&#10;npm test"
        />
      </label>
      <button type="submit" className="ui-button" disabled={busy}>
        Simpan Kebijakan
      </button>
      {message && <p role="status" className="opacity-80">{message}</p>}
    </form>
  );
}
