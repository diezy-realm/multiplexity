import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Check, Plus, RefreshCw, SlidersHorizontal, Square, X } from 'lucide-react';
import Select from './Select';
import ModelInput from './ModelInput';
import ProviderBrandIcon from './ProviderBrandIcon';
import { PROVIDERS, supportsEffort, type ProviderId, type Connection, type Effort, type Permission, type LogSource, type ChatAttachment } from '@/lib/ai/catalog';
import { providerCapabilities } from '@/lib/ai/capabilities';
import { COMPOSER_MODES, type ComposerMenu, type ComposerMode } from '@/lib/ai/composer';

export interface ChatComposerProps {
  embedded?: boolean;
  draft: string;
  mode: ComposerMode;
  menu: ComposerMenu;
  sources: LogSource[];
  attachments: ChatAttachment[];
  skill: string;
  provider: ProviderId;
  model: string;
  models: { id: string; name: string }[];
  connections: Connection[];
  effort: Effort;
  permission: Permission;
  busy: boolean;
  loading: boolean;
  attaching: boolean;
  stopping: boolean;
  loadingModels: boolean;
  modelMessage: string;
  status: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  panel?: ReactNode;
  onDraft: (value: string) => void;
  onMode: (mode: ComposerMode) => void;
  onMenu: (menu: ComposerMenu) => void;
  onProvider: (value: ProviderId) => void;
  onModel: (value: string) => void;
  onEffort: (value: Effort) => void;
  onPermission: (value: Permission) => void;
  onRemoveSource: (index: number) => void;
  onRemoveAttachment: (index: number) => void;
  onRemoveSkill: () => void;
  onAttach: (files: FileList | File[] | null) => Promise<void>;
  onArtifacts: () => void;
  onLoadModels: () => void;
  onSend: () => void;
  onStop: () => void;
}

const labels = {
  add: 'Tambah ke chat',
  source: 'Sumber log',
  skills: 'Skills',
  commands: 'Diagnostik',
  artifacts: 'Artifact',
  settings: 'Pengaturan AI',
};

export default function ChatComposer(props: ChatComposerProps) {
  const { draft, mode, menu, provider, model, busy, loading, inputRef, sources, attachments, skill, embedded, onMenu } = props;
  const id = useId();
  const root = useRef<HTMLFormElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = busy || loading || props.attaching;
  const capability = providerCapabilities(provider, model);
  const modeLabel = COMPOSER_MODES.find(item => item.id === mode)?.label;

  const close = () => {
    props.onMenu(null);
    requestAnimationFrame(() => {
      (trigger.current?.isConnected ? trigger.current : inputRef.current)?.focus();
    });
  };

  function toggle(next: ComposerMenu, event: React.MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    if (menu === next) close();
    else props.onMenu(next);
  }

  useEffect(() => {
    if (!menu) return;
    if (document.activeElement?.tagName === 'TEXTAREA') trigger.current = inputRef.current;
    else popup.current?.querySelector<HTMLElement>('button:not(:disabled),[tabindex="0"],input')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest('[data-radix-popper-content-wrapper]'))
      ) {
        onMenu(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu, onMenu, inputRef]);

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = Math.min(node.scrollHeight || 64, 200) + 'px';
    }
  }, [draft, inputRef]);

  const context = (
    <div className="composer-context-list" aria-label="Konteks terpilih">
      {sources.map((source, index) => (
        <span className="composer-context" key={`${source.vmId}:${source.kind}:${source.target}`}>
          <span className="truncate" title={source.label}>
            @ {source.label}{!mode ? ' · tidak dikirim' : ''}
          </span>
          <button
            type="button"
            className="icon-action"
            aria-label={`Hapus sumber ${source.label}`}
            disabled={locked}
            onClick={() => props.onRemoveSource(index)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      ))}
      {attachments.map((file, index) => (
        <span className="composer-context" key={index}>
          {file.mediaType && <img src={`data:${file.mediaType};base64,${file.content}`} alt={file.name} width={36} height={36} />}
          <span className="truncate" title={file.name}>{file.name}</span>
          <button
            type="button"
            className="icon-action"
            aria-label={`Hapus lampiran ${file.name}`}
            disabled={locked}
            onClick={() => props.onRemoveAttachment(index)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      ))}
      {skill && (
        <span className="composer-context">
          <span className="truncate">/{skill}</span>
          <button
            type="button"
            className="icon-action"
            aria-label={`Hapus skill ${skill}`}
            disabled={locked}
            onClick={props.onRemoveSkill}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      )}
    </div>
  );

  return (
    <form
      ref={root}
      aria-label="Composer chat"
      className="chat-composer"
      data-embedded={!!embedded}
      onSubmit={event => {
        event.preventDefault();
        if (!locked) props.onSend();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && menu) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      {menu && (
        <div
          ref={popup}
          id={id + '-popup'}
          role="dialog"
          aria-label="Pilihan chat"
          className="composer-popup"
          onKeyDown={event => {
            if (!['add', 'commands', 'skills'].includes(menu) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (!buttons.length) return;
            event.preventDefault();
            buttons[
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
            ].focus();
          }}
        >
          <div className="composer-popup-heading">
            <span>{labels[menu]}</span>
            <button type="button" aria-label="Tutup pilihan" className="icon-action" onClick={close}>
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          {(menu === 'add' || menu === 'commands') && (
            <fieldset className="composer-menu-group">
              <legend>Mode</legend>
              {COMPOSER_MODES.map(item => (
                <button
                  type="button"
                  className="composer-menu-item"
                  aria-pressed={mode === item.id}
                  key={item.id}
                  disabled={locked}
                  onClick={() => {
                    props.onMode(item.id);
                    close();
                  }}
                >
                  <span>{item.label}</span>
                  {mode === item.id && <Check aria-hidden="true" size={14} />}
                </button>
              ))}
            </fieldset>
          )}
          {menu === 'add' && (
            <fieldset className="composer-menu-group">
              <legend>Konteks</legend>
              <button type="button" className="composer-menu-item" aria-label="Sumber log" onClick={() => props.onMenu('source')}>
                Sumber VM / service / file log <kbd>@</kbd>
              </button>
              <button
                type="button"
                className="composer-menu-item"
                aria-label="Lampirkan file"
                disabled={locked}
                onClick={() => {
                  close();
                  fileRef.current?.click();
                }}
              >
                Lampirkan file
              </button>
              <button type="button" className="composer-menu-item" aria-label="Lampirkan Artifact" onClick={props.onArtifacts}>
                Lampirkan Artifact
              </button>
              <button type="button" className="composer-menu-item" aria-label="Skills" onClick={() => props.onMenu('skills')}>
                Pilih skill <kbd>/</kbd>
              </button>
            </fieldset>
          )}
          {menu === 'settings' ? (
            <div className="composer-settings">
              <p>
                {props.connections.find(connection => connection.provider === provider)?.configured
                  ? 'Konfigurasi tersimpan; ketersediaan model diperiksa saat kirim.'
                  : 'Provider belum dikonfigurasi. Buka Setting → AI.'}
              </p>
              <label>
                Effort
                <Select
                  aria-label="Effort"
                  value={capability.effort ? props.effort : 'default'}
                  disabled={locked || !supportsEffort(provider, model)}
                  onChange={event => props.onEffort(event.target.value as Effort)}
                  className="ui-field"
                >
                  <option value="default">Default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </label>
              <label>
                Permission
                <Select
                  aria-label="Permission"
                  value={props.permission}
                  disabled={locked}
                  onChange={event => props.onPermission(event.target.value as Permission)}
                  className="ui-field"
                >
                  <option value="read-only">Read only</option>
                  <option value="ask">Ask</option>
                  <option value="allow-all">Allow All</option>
                </Select>
              </label>
              <p>Allow All mengikuti tool dan izin adaptor provider.</p>
              <p>{capability.images ? 'Adaptor gambar tersedia; vision mengikuti model.' : 'Adaptor gambar tidak tersedia.'}</p>
              <button
                type="button"
                className="ui-button bg-blue-600 text-white border-transparent hover:bg-blue-700"
                aria-label="Simpan"
                disabled={locked}
                onClick={close}
              >
                Simpan
              </button>
              <p role="status">{props.modelMessage}</p>
            </div>
          ) : (
            props.panel
          )}
        </div>
      )}

      {mode && (
        <div className="composer-mode-row" aria-live="polite">
          <span className="composer-mode" data-testid="composer-mode">
            <span>{modeLabel}</span>
            <button type="button" className="icon-action" aria-label={`Hapus mode ${modeLabel}`} disabled={locked} onClick={() => props.onMode(null)}>
              <X aria-hidden="true" size={14} />
            </button>
          </span>
        </div>
      )}

      {(sources.length > 0 || attachments.length > 0 || skill) &&
        (embedded ? (
          <details className="composer-context-summary">
            <summary>
              Konteks · {sources.length} sumber{!mode && sources.length ? ' tidak dikirim' : ''} · {attachments.length} file{skill ? ' · 1 skill' : ''}
            </summary>
            {context}
          </details>
        ) : (
          context
        ))}

      <textarea
        ref={inputRef}
        aria-label="Pesan chat"
        aria-describedby={mode ? id + '-notice' : undefined}
        name="message"
        autoComplete="off"
        rows={2}
        maxLength={16000}
        value={draft}
        disabled={locked}
        placeholder={mode === 'resources' ? 'Apa yang ingin diperiksa pada VM…' : mode ? 'Apa yang ingin dianalisis…' : 'Kirim pesan…'}
        onChange={event => props.onDraft(event.target.value)}
        onPaste={event => {
          const files = Array.from(event.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => !!file);
          if (files.length) {
            if (!event.clipboardData.getData('text/plain')) event.preventDefault();
            void props.onAttach(files);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && menu) return;
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!locked) {
              props.onMenu(null);
              props.onSend();
            }
          }
        }}
      />

      <div className="composer-toolbar">
        <button
          type="button"
          aria-label="Tambah ke chat"
          title="Mode dan konteks"
          aria-haspopup="dialog"
          aria-expanded={menu === 'add'}
          aria-controls={menu === 'add' ? id + '-popup' : undefined}
          disabled={locked}
          className="icon-action composer-add"
          onClick={event => toggle('add', event)}
        >
          <Plus aria-hidden="true" size={18} strokeWidth={2} />
        </button>
        <div className="composer-model-controls items-center">
          <ProviderBrandIcon provider={provider} size={16} className="ml-1" />
          <Select aria-label="AI provider" value={provider} onChange={event => props.onProvider(event.target.value as ProviderId)} disabled={locked} className="composer-provider">
            {PROVIDERS.map(item => (
              <option value={item.id} key={item.id}>
                {item.name}{props.connections.find(connection => connection.provider === item.id)?.configured ? ' · tersimpan' : ''}
              </option>
            ))}
          </Select>
          <ModelInput value={model} models={props.models} onChange={props.onModel} disabled={locked} className="composer-model" />
          <button
            type="button"
            aria-label="Refresh model"
            title={props.loadingModels ? 'Memuat model…' : 'Refresh model'}
            className="icon-action shrink-0"
            disabled={locked || props.loadingModels}
            onClick={props.onLoadModels}
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={1.9} className={props.loadingModels ? 'animate-spin' : ''} />
          </button>
        </div>
        <button
          type="button"
          aria-label="Pengaturan AI"
          title={`${props.permission} · effort ${capability.effort ? props.effort : 'default'}`}
          aria-haspopup="dialog"
          aria-expanded={menu === 'settings'}
          aria-controls={menu === 'settings' ? id + '-popup' : undefined}
          className="icon-action"
          disabled={locked}
          onClick={event => toggle('settings', event)}
        >
          <SlidersHorizontal aria-hidden="true" size={17} strokeWidth={1.7} />
        </button>
        {busy ? (
          <button type="button" className="composer-send" aria-label="Hentikan respons" disabled={props.stopping} onClick={props.onStop}>
            <Square aria-hidden="true" size={14} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="composer-send" aria-label="Kirim pesan" disabled={locked || (!draft.trim() && !attachments.length)}>
            <ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} />
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        aria-label="Attachment file"
        multiple
        hidden
        accept="image/png,image/jpeg,image/webp,.txt,.log,.out,.err,.md,.json,.csv,.yaml,.yml,.sql,.ts,.tsx,.js,.go,.py"
        onChange={event => {
          void props.onAttach(event.target.files).finally(() => {
            if (fileRef.current) fileRef.current.value = '';
          });
        }}
      />
      {mode && (
        <p className="composer-notice" id={id + '-notice'}>
          Sumber dibaca saat kirim; menambah waktu dan dikirim ke {PROVIDERS.find(item => item.id === provider)?.name}.
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {props.stopping ? 'Menghentikan…' : busy ? 'Respons berjalan…' : props.attaching ? 'Membaca file…' : loading ? 'Memuat…' : props.status}
      </span>
    </form>
  );
}
