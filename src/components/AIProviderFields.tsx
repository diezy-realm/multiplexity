import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react';
import { useId } from 'react';
import type { Connection, ProviderDefinition } from '@/lib/ai/catalog';
import { editableEndpoint, type Identity, type ProbeResult, type RuntimeConfig } from '@/lib/ai/provider-settings';

export function ProviderSwitch({ label, enabled, disabled, onChange }: { label: string; enabled: boolean; disabled?: boolean; onChange: () => void }) {
  return <button type="button" className="ai-switch" role="switch" aria-label={label} aria-checked={enabled} disabled={disabled} onClick={onChange}><span /></button>;
}

export function IdentityFields({ value, onChange }: { value: Identity; onChange: (value: Identity) => void }) {
  const colorId = useId();
  return <div className="ai-field-list">
    <label className="ai-field"><span>Label</span><input className="ai-input" value={value.label} maxLength={64} required onChange={event => onChange({ ...value, label: event.target.value })} /></label>
    <label className="ai-field"><span>Deskripsi <small>Opsional</small></span><textarea className="ai-input" value={value.description} maxLength={280} rows={2} onChange={event => onChange({ ...value, description: event.target.value })} /></label>
    <div className="ai-field"><label htmlFor={colorId}>Warna aksen</label><div className="ai-color">
      <input id={colorId} type="color" value={value.color || '#206cce'} onChange={event => onChange({ ...value, color: event.target.value })} />
      {value.color && <button type="button" className="ui-button" onClick={() => onChange({ ...value, color: '' })}>Reset</button>}
    </div></div>
  </div>;
}

export function RuntimeFields({ definition, connection, value, onChange, busy, testing, result, onTest, onLogin }: {
  definition: ProviderDefinition;
  connection?: Connection;
  value: RuntimeConfig;
  onChange: (value: RuntimeConfig) => void;
  busy: boolean;
  testing: boolean;
  result?: ProbeResult;
  onTest: () => void;
  onLogin: () => void;
}) {
  const cli = definition.mode === 'cli';
  const keyId = useId();
  return <div className="ai-field-list">
    {cli ? <>
      <label className="ai-field"><span>Binary path <small>Kosongkan untuk deteksi otomatis</small></span>
        <input className="ai-input ai-code" disabled={busy} value={value.cliPath} placeholder={result?.executable || connection?.executable || 'Path absolut executable atau folder bin'} onChange={event => onChange({ ...value, cliPath: event.target.value })} />
      </label>
      {(result?.executable || connection?.executable) && !value.cliPath && <p className="ai-muted ai-code">{result?.executable || connection?.executable}</p>}
    </> : <label className="ai-field"><span>API endpoint</span>
      <input className="ai-input ai-code" disabled={busy} readOnly={!editableEndpoint(definition.id)} value={value.endpoint} placeholder="https://provider.example/v1" onChange={event => onChange({ ...value, endpoint: event.target.value })} />
    </label>}
    {definition.id !== 'codex' && <div className="ai-field">
      <label htmlFor={keyId}>API key {cli || ['custom', 'ollama'].includes(definition.id) ? <small>Opsional</small> : null}</label>
      <div className="ai-field-list">
        <input className="ai-input" id={keyId} type="password" autoComplete="off" disabled={busy} value={value.apiKey} placeholder={value.clearKey ? 'Key akan dihapus saat disimpan' : connection?.apiKeyHint ? 'Key sudah tersimpan' : 'Masukkan API key'} onChange={event => onChange({ ...value, apiKey: event.target.value, clearKey: false })} />
        {connection?.apiKeyHint && <button type="button" className="ai-text-button" disabled={busy} onClick={() => onChange({ ...value, apiKey: '', clearKey: !value.clearKey })}>{value.clearKey ? 'Pertahankan key' : 'Hapus key tersimpan'}</button>}
      </div>
    </div>}
    <div className="ai-actions">
      <button type="button" className="ui-button" disabled={busy} onClick={onTest}>
        {testing ? <LoaderCircle className="animate-spin" size={15} /> : <RotateCw size={15} />} {testing ? 'Menguji…' : 'Test connection'}
      </button>
      {cli && <button type="button" className="ui-button" disabled={busy} onClick={onLogin}>Buka login CLI</button>}
      <a className="ai-text-button" href={definition.keyUrl} target="_blank" rel="noreferrer">Dokumentasi <ExternalLink size={12} /></a>
    </div>
    {result && <p className="ai-probe-ok" role="status">Koneksi terverifikasi{result.version && ` · ${result.version}`} · {result.models.length} model</p>}
  </div>;
}
