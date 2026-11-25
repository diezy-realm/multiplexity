'use client';
import { useEffect } from 'react';
import { type Appearance, validAppearance } from '@/lib/appearance';

export function applyAppearance(value: Appearance) {
  if (!validAppearance(value)) return;
  const root = document.documentElement;
  root.classList.toggle('dark', value.theme === 'dark');
  root.style.fontSize = `${value.fontSize}px`;
  root.style.setProperty('--user-font', `"${value.fontFamily}", system-ui, sans-serif`);
  root.dataset.customTheme = Object.keys(value.colors).length ? 'true' : 'false';
  for (const key of ['base','foreground','sidebar','sidebar-fg','panel','border','input','input-fg','button','button-fg']) root.style.removeProperty(`--custom-${key}`);
  const mapping: Record<string,string> = { 'editor.background':'base','editor.foreground':'foreground','sideBar.background':'sidebar','sideBar.foreground':'sidebar-fg','panel.background':'panel','panel.border':'border','input.background':'input','input.foreground':'input-fg','button.background':'button','button.foreground':'button-fg' };
  for (const [key, name] of Object.entries(mapping)) if (value.colors[key]) root.style.setProperty(`--custom-${name}`, value.colors[key]);
  for (const name of ['surface','text','border','hover','scroll']) root.style.removeProperty(`--ui-${name}`);
  if (value.colors['editor.background']) root.style.setProperty('--ui-surface',value.colors['input.background'] || value.colors['editor.background']);
  if (value.colors['editor.foreground']) root.style.setProperty('--ui-text',value.colors['editor.foreground']);
  if (value.colors['panel.border']) root.style.setProperty('--ui-border',value.colors['panel.border']);
  if (Object.keys(value.colors).length) {
    root.style.setProperty('--ui-hover','color-mix(in srgb, var(--ui-text) 12%, var(--ui-surface))');
    root.style.setProperty('--ui-scroll','color-mix(in srgb, var(--ui-text) 35%, var(--ui-surface))');
  }
  localStorage.setItem('vm-dashboard-theme', value.theme);
  localStorage.setItem('manager-appearance', JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('terminal-appearance', { detail: value }));
}
export default function AppearanceProvider() {
  useEffect(() => {
    let active = true;
    const load = () => { fetch('/api/appearance').then(async response => { if (response.ok && active) applyAppearance(await response.json()); }).catch(() => {}); };
    try { const cached = JSON.parse(localStorage.getItem('manager-appearance') || 'null'); if (validAppearance(cached)) applyAppearance(cached); } catch { /* Use server defaults. */ }
    load(); window.addEventListener('appearance-updated', load);
    return () => { active = false; window.removeEventListener('appearance-updated', load); };
  }, []);
  return null;
}
