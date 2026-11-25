'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export function reorderIds(ids: string[], source: string, target: string): string[] {
  const from = ids.indexOf(source);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function useCardOrder<T extends { id: string }>(scope: string, items: T[]) {
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ready = useRef(false);
  const scopeRef = useRef(scope);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  scopeRef.current = scope;

  useEffect(() => {
    let active = true;
    ready.current = false;
    setOrder([]);
    fetch(`/api/preferences?scope=${encodeURIComponent(scope)}`)
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) setOrder(data.order);
      })
      .catch(() => { if (active) setError('Urutan tersimpan belum dapat dimuat.'); })
      .finally(() => { if (active) ready.current = true; });
    return () => { active = false; };
  }, [scope]);

  const ordered = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]));
    return [...order.filter(id => byId.has(id)).map(id => byId.get(id)!), ...items.filter(item => !order.includes(item.id))];
  }, [items, order]);

  async function move(source: string, target: string) {
    if (!ready.current) return;
    const ids = ordered.map(item => item.id);
    const next = reorderIds(ids, source, target);
    if (next === ids) return;
    setOrder(next);
    setError('');
    const currentScope = scope;
    try {
      const save = saveQueue.current.catch(() => {}).then(async () => {
        const response = await fetch('/api/preferences', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: currentScope, order: next }),
        });
        if (!response.ok) throw new Error();
      });
      saveQueue.current = save;
      await save;
    } catch {
      if (scopeRef.current === currentScope) setError('Urutan berubah tetapi belum tersimpan.');
    }
  }

  function handleProps(id: string, label: string) {
    return {
      draggable: true,
      'aria-label': `Susun ${label}. Gunakan tombol panah atas atau bawah.`,
      title: 'Geser untuk menyusun · ↑ ↓',
      onDragStart: (event: React.DragEvent) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging(id); },
      onDragEnd: () => setDragging(null),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const index = ordered.findIndex(item => item.id === id);
        const target = ordered[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) void move(id, target.id);
      },
    };
  }

  function dropProps(id: string) {
    return {
      onDragOver: (event: React.DragEvent) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } },
      onDrop: (event: React.DragEvent) => { event.preventDefault(); if (dragging) void move(dragging, id); setDragging(null); },
      'data-card-id': id,
    };
  }
  return { ordered, handleProps, dropProps, error, dragging };
}
