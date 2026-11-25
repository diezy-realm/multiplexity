'use client';
import { useState } from 'react';
import { Archive, ArchiveRestore, Check, MessageSquare, Pencil, Plus, Search, X } from 'lucide-react';
import Dialog from './Dialog';
import type { Conversation } from '@/lib/ai/conversations';

type FilterTab = 'all' | 'active' | 'archived';

export default function ConversationPicker({
  disabled,
  onSelect,
  activeId,
}: {
  activeId?: string;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch('/api/ai/conversations');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.conversations ?? []);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Percakapan gagal dimuat.');
    } finally {
      setPending(false);
    }
  }

  async function update(item: Conversation, change: Record<string, unknown>) {
    const response = await fetch('/api/ai/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, ...change }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    await load();
    setEditingId(null);

    if (change.archived && item.id === activeId) {
      const next = items.find(row => row.id !== item.id && !row.archived);
      if (next) {
        await onSelect(next.id);
      } else {
        const created = await fetch('/api/ai/conversations', { method: 'POST' });
        const body = await created.json();
        if (!created.ok) throw new Error(body.error);
        await onSelect(body.conversation.id);
      }
      setOpen(false);
    }
  }

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'active') return !item.archived;
    if (filter === 'archived') return !!item.archived;
    return true;
  });

  const activeCount = items.filter(item => !item.archived).length;
  const archivedCount = items.filter(item => !!item.archived).length;

  return (
    <>
      <button
        type="button"
        className="ui-button"
        disabled={disabled || pending}
        onClick={() =>
          void run(async () => {
            const response = await fetch('/api/ai/conversations', { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            await onSelect(data.conversation.id);
          })
        }
      >
        <Plus aria-hidden="true" size={14} />
        Chat baru
      </button>
      <button
        type="button"
        className="ui-button"
        disabled={disabled || pending}
        onClick={() => {
          setOpen(true);
          setEditingId(null);
          void run(load);
        }}
      >
        <MessageSquare aria-hidden="true" size={14} />
        Percakapan
      </button>

      {error && !open && (
        <span role="alert" className="text-xs text-red-500">
          {error}
        </span>
      )}

      {open && (
        <Dialog title="Percakapan" onClose={() => setOpen(false)} className="max-w-xl">
          <div className="space-y-4">
            <div className="relative">
              <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                aria-label="Cari percakapan"
                placeholder="Cari percakapan…"
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="ui-field w-full pl-9"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div role="tablist" aria-label="Filter percakapan" className="panel-tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'active'}
                  onClick={() => setFilter('active')}
                  className="panel-tab text-xs"
                >
                  Aktif ({activeCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'archived'}
                  onClick={() => setFilter('archived')}
                  className="panel-tab text-xs"
                >
                  Arsip ({archivedCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'all'}
                  onClick={() => setFilter('all')}
                  className="panel-tab text-xs"
                >
                  Semua ({items.length})
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}

            <div className="space-y-1.5 max-h-[55dvh] overflow-y-auto pr-1">
              {filteredItems.map(item => {
                const isActive = item.id === activeId;
                const isEditing = editingId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`group flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                      isActive
                        ? 'border-blue-500/60 bg-blue-500/10'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    {isEditing ? (
                      <form
                        className="flex flex-1 items-center gap-2 min-w-0"
                        onSubmit={event => {
                          event.preventDefault();
                          if (editingTitle.trim()) {
                            void run(() => update(item, { title: editingTitle.trim() }));
                          }
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={`Ubah nama ${item.title}`}
                          className="ui-field min-w-0 flex-1 py-1 text-sm"
                          value={editingTitle}
                          maxLength={120}
                          onChange={event => setEditingTitle(event.target.value)}
                        />
                        <button
                          type="submit"
                          aria-label="Simpan nama"
                          disabled={pending || !editingTitle.trim()}
                          className="icon-action text-emerald-500"
                        >
                          <Check aria-hidden="true" size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label="Batal ubah nama"
                          disabled={pending}
                          onClick={() => setEditingId(null)}
                          className="icon-action text-gray-400"
                        >
                          <X aria-hidden="true" size={15} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={pending || !!item.archived}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() =>
                            void run(async () => {
                              await onSelect(item.id);
                              setOpen(false);
                            })
                          }
                          className="flex-1 min-w-0 text-left disabled:opacity-60"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-sm font-medium">{item.title}</span>
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                                Aktif
                              </span>
                            )}
                            {item.archived ? (
                              <span className="shrink-0 rounded-full bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                                Arsip
                              </span>
                            ) : null}
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0 opacity-75 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            aria-label={`Ubah nama ${item.title}`}
                            title="Ubah nama"
                            disabled={pending}
                            onClick={() => {
                              setEditingId(item.id);
                              setEditingTitle(item.title);
                            }}
                            className="icon-action text-gray-400 hover:text-gray-200"
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={item.archived ? `Pulihkan ${item.title}` : `Arsipkan ${item.title}`}
                            title={item.archived ? 'Pulihkan' : 'Arsipkan'}
                            disabled={pending}
                            onClick={() => void run(() => update(item, { archived: !item.archived }))}
                            className="icon-action text-gray-400 hover:text-amber-400"
                          >
                            {item.archived ? (
                              <ArchiveRestore aria-hidden="true" size={14} />
                            ) : (
                              <Archive aria-hidden="true" size={14} />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {!filteredItems.length && (
                <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {search ? 'Tidak ada percakapan yang cocok.' : 'Belum ada percakapan di kategori ini.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
