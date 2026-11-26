'use client';
import ThemeJsonEditor from '@/components/ThemeJsonEditor';
import Select from '@/components/Select';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { signOut } from '@/client/auth';
import { parse } from 'jsonc-parser';
import AIManagement from '@/components/AIManagement';
import IntegrationsSettings from '@/components/IntegrationsSettings';
import PoliciesSettings from '@/components/PoliciesSettings';
import { FONT_OPTIONS, THEME_KEYS, defaultAppearance, type Appearance } from '@/lib/appearance';
import { applyAppearance } from '@/components/AppearanceProvider';
import { themePresets, selectedPreset } from '@/lib/themes';
const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm';

export default function SettingsPage() {
  const [params] = useSearchParams();
  const [section, setSection] = useState<'Account'|'AI'|'Appearance'|'Agent'|'Integrations'|'Policies'>(
    params.get('section') === 'integrations' ? 'Integrations' : params.get('section') === 'ai' ? 'AI' : 'Account',
  );
  const [username, setUsername] = useState(''); const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [workspace, setWorkspace] = useState('');
  useEffect(() => {
    fetch('/api/account').then(response => response.json()).then(data => { setUsername(data.account?.username ?? ''); }).catch(() => setMessage('Akun tidak dapat dimuat.'));
    fetch('/api/appearance').then(response => response.json()).then(data => setAppearance(data)).catch(() => {});
    fetch('/api/artifacts').then(response => response.json()).then(data => setWorkspace(data.root ?? '')).catch(() => {});
  }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(''); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Permintaan gagal.'); } finally { setBusy(false); } }
  async function saveAppearance(value = appearance) { const response = await fetch('/api/appearance', { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(value) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); applyAppearance(value); window.dispatchEvent(new Event('appearance-updated')); setMessage('Tersimpan'); }
  async function importTheme(file?: File) {
    if (!file) return;
    if (file.size > 1000000 || /^config\.json$/i.test(file.name)) throw new Error('Pilih file color theme VS Code JSON/JSONC, maksimal 1 MB.');
    const errors: import('jsonc-parser').ParseError[] = []; const theme = parse(await file.text(), errors, { allowTrailingComma: true });
    if (errors.length || !theme?.colors || typeof theme.colors !== 'object') throw new Error('File bukan color theme VS Code.');
    const colors = Object.fromEntries(Object.entries(theme.colors).filter(([key,color]) => THEME_KEYS.includes(key) && typeof color === 'string' && /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color)));
    const value = { ...appearance, theme: (theme.type === 'light' || theme.type === 'vs' ? 'light' : 'dark') as 'light'|'dark', colors } as Appearance;
    setAppearance(value); await saveAppearance(value);
  }
  return <div className="max-w-4xl mx-auto text-gray-900 dark:text-gray-100"><div role="tablist" aria-label="Bagian pengaturan" className="panel-tabs mb-5">{(['Account','AI','Appearance','Agent','Integrations','Policies'] as const).map(item => <button type="button" role="tab" aria-selected={section === item} key={item} onClick={() => { setSection(item); setMessage(''); }} className="panel-tab text-sm">{item === 'AI' ? 'AI Management' : item}</button>)}</div>
    <div className="max-w-xl space-y-4">
      {section === 'Account' && <><p className="text-sm">{username}</p><label className="block text-sm">Password saat ini<input type="password" autoComplete="current-password" aria-label="Password saat ini" className={`${field} mt-1.5`} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
        <label className="block text-sm">Password baru<input type="password" autoComplete="new-password" aria-label="Password baru" minLength={12} className={`${field} mt-1.5`} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
        <button type="button" disabled={busy || newPassword.length < 12 || !currentPassword} onClick={() => void run(async () => { const response = await fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ currentPassword, newPassword }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await signOut({ callbackUrl:'/login' }); })} className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-40">Change Password</button></>}
      {section === 'AI' && <AIManagement />}
      {section === 'Appearance' && <><label className="block text-sm">Theme<Select aria-label="Theme" className={`${field} mt-1.5`} value={selectedPreset(appearance)} onChange={event => { const preset = themePresets.find(item=>item.id===event.target.value); setAppearance({ ...appearance, theme: preset?.theme || event.target.value as 'dark'|'light', colors:preset?.colors || {} }); }}><option value="dark">Dark</option><option value="light">Light</option>{themePresets.map(preset=><option key={preset.id} value={preset.id}>{preset.name}</option>)}{selectedPreset(appearance) === 'custom' && <option value="custom">Custom</option>}</Select></label><label className="block text-sm">Font<Select aria-label="Font style" className={`${field} mt-1.5`} value={appearance.fontFamily} onChange={event => setAppearance({ ...appearance, fontFamily:event.target.value })}>{FONT_OPTIONS.map(font => <option key={font}>{font}</option>)}</Select></label><div className="grid grid-cols-2 gap-3"><label className="text-sm">Font size<input aria-label="Font size" type="number" min={11} max={22} className={`${field} mt-1.5`} value={appearance.fontSize} onChange={event => { const n = Number.parseInt(event.target.value, 10); if (Number.isFinite(n)) setAppearance({ ...appearance, fontSize: n }); }} /></label><label className="text-sm">Terminal size<input aria-label="Terminal font size" type="number" min={10} max={28} className={`${field} mt-1.5`} value={appearance.terminalFontSize} onChange={event => { const n = Number.parseInt(event.target.value, 10); if (Number.isFinite(n)) setAppearance({ ...appearance, terminalFontSize: n }); }} /></label></div><label className="block text-sm">VS Code color theme<input aria-label="Import VS Code theme" type="file" accept=".json,.jsonc" className="block mt-2 text-xs" onChange={event => void run(() => importTheme(event.target.files?.[0]))} /></label><button type="button" disabled={busy} onClick={() => void run(() => saveAppearance())} className="rounded bg-blue-600 text-white px-3 py-2 text-sm">Simpan tampilan</button><ThemeJsonEditor appearance={appearance} onApply={async value=>{await saveAppearance(value);setAppearance(value);}} /></>}
      {section === 'Agent' && <><p className="text-sm break-all font-mono">{workspace}</p><div className="text-xs text-gray-500 space-y-1"><p>rules.md · steering.md · skills/ · artifacts/</p><p>Folder yang sama dipakai provider pada akun ini. Vault Snipet tidak dimasukkan ke konteks agent.</p></div><a href="/artifacts" className="inline-block rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm">Buka workspace</a></>}
      {section === 'Integrations' && <IntegrationsSettings initialKind={params.get('connector') === 'bitbucket' ? 'bitbucket' : params.get('connector') === 'ghes' ? 'ghes' : undefined} />}
      {section === 'Policies' && <PoliciesSettings />}
      {message && <p role="status" className="text-sm text-gray-500 dark:text-gray-400">{message}</p>}
    </div></div>;
}
