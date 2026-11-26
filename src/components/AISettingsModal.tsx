import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import Dialog from './Dialog';
import ProviderBrandIcon from './ProviderBrandIcon';
import { IdentityFields, RuntimeFields } from './AIProviderFields';
import { PROVIDERS, type Connection, type ProviderDefinition } from '@/lib/ai/catalog';
import { providerWrite, runtimeConfig, type Identity, type ProbeResult } from '@/lib/ai/provider-settings';

const steps = ['Provider', 'Identitas', 'Konfigurasi'];

export default function AISettingsModal({ connections, makeDefault, onClose, onSaved }: {
  connections: Connection[];
  makeDefault: boolean;
  onClose: () => void;
  onSaved: (provider: ProviderDefinition['id']) => void;
}) {
  const [step, setStep] = useState(0);
  const [definition, setDefinition] = useState<ProviderDefinition>();
  const [identity, setIdentity] = useState<Identity>({ label: '', description: '', color: '' });
  const [config, setConfig] = useState(() => runtimeConfig(PROVIDERS[0]));
  const [result, setResult] = useState<ProbeResult>();
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'login'>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const detected = connections.find(item => item.provider === definition?.id);
  const markConfig = (next: typeof config) => {
    setConfig(next);
    setResult(undefined);
    setNotice('');
    setError('');
  };

  function select(next: ProviderDefinition) {
    if (next.id === definition?.id) return;
    setDefinition(next);
    setIdentity({ label: next.name, description: '', color: '' });
    markConfig(runtimeConfig(next));
    setModel(next.defaultModel);
  }

  async function perform(operation: NonNullable<typeof busy>) {
    if (!definition || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(operation);
    setNotice('');
    setError('');
    try {
      const payload = { provider: definition.id, model, ...config };
      if (operation === 'test') {
        setResult(undefined);
        const data = await providerWrite<ProbeResult>('/api/ai/probe', payload, 'POST', abort.signal);
        setResult(data);
        if (model && !data.models.some(entry => entry.id === model)) setModel('');
      } else if (operation === 'login') {
        const data = await providerWrite<{ message: string }>('/api/ai/connect', payload, 'POST', abort.signal);
        setNotice(data.message);
      } else {
        await providerWrite('/api/ai/settings', {
          ...payload, verify: true, makeDefault,
          profile: { ...identity, models: result?.models ?? [], disabledModels: [] },
        }, 'POST', abort.signal);
        onSaved(definition.id);
      }
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Permintaan provider gagal.');
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setBusy(undefined);
    }
  }

  function next(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !definition) return;
    if (step === 2) {
      if (result) void perform('save');
      return;
    }
    if (step === 1 && !identity.label.trim()) return;
    setStep(step + 1);
    if (step === 1 && definition.mode === 'cli' && detected?.executable && !result) void perform('test');
  }

  return <Dialog title="Tambah AI Provider" onClose={onClose} className="ai-wizard max-w-2xl">
    <ol className="ai-steps" aria-label="Tahapan penambahan provider">
      {steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>
        <span>{index < step ? <Check size={13} aria-label="Selesai" /> : index + 1}</span>{label}
      </li>)}
    </ol>
    <form onSubmit={next}>
      <div className="ai-wizard-body">
        {step === 0 && <fieldset className="ai-provider-grid">
          <legend>Pilih provider</legend>
          {PROVIDERS.map(item => {
            const connection = connections.find(entry => entry.provider === item.id);
            const current = connection?.saved ?? connection?.configured ?? false;
            return <label key={item.id} className="ai-provider-choice">
              <input type="radio" name="provider-type" checked={definition?.id === item.id} disabled={current} onChange={() => select(item)} />
              <ProviderBrandIcon provider={item.id} size={20} />
              <span><strong>{item.name}</strong><small>{current ? 'Sudah dikonfigurasi' : connection?.executable ? 'CLI terdeteksi' : item.mode === 'cli' ? 'CLI lokal' : 'API'}</small></span>
            </label>;
          })}
        </fieldset>}
        {step === 1 && <IdentityFields value={identity} onChange={setIdentity} />}
        {step === 2 && definition && <>
          <RuntimeFields definition={definition} connection={detected} value={config} onChange={markConfig} busy={!!busy} testing={busy === 'test'} result={result} onTest={() => void perform('test')} onLogin={() => void perform('login')} />
          {result && <label className="ai-field mt-3"><span>Model default</span>
            <select className="ai-input" value={model} onChange={event => setModel(event.target.value)}>
              <option value="">{definition.mode === 'cli' ? 'Default CLI' : 'Pilih nanti'}</option>
              {model && !result.models.some(item => item.id === model) && <option value={model}>{model}</option>}
              {result.models.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>}
          {notice && <p role="status" className="ai-muted mt-3">{notice}</p>}
          {error && <p role="alert" className="ai-error mt-3">{error}</p>}
        </>}
      </div>
      <footer className="ai-wizard-footer">
        <button type="button" disabled={!!busy} className="ui-button" onClick={step === 0 ? onClose : () => setStep(step - 1)}>
          {step > 0 && <ArrowLeft size={15} />}{step === 0 ? 'Batal' : 'Kembali'}
        </button>
        <button type="submit" className="ai-primary" disabled={!!busy || !definition || (step === 1 && !identity.label.trim()) || (step === 2 && !result)}>
          {step === 2 ? <><Plus size={15} /> Tambah provider</> : <>Lanjut <ArrowRight size={15} /></>}
        </button>
      </footer>
    </form>
  </Dialog>;
}
