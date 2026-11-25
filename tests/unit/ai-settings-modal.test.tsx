// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AISettingsModal from '@/components/AISettingsModal';

const executable = 'C:\\Test\\Codex\\bin\\codex.exe';
let operations: string[];
let failSave: boolean;
let stored: string;
let desktop: boolean;
beforeEach(() => {
  operations = []; failSave = false; stored = ''; desktop = true;
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const response = (body: object, status = 200) => ({ ok: status === 200, status, json: async () => body });
    if (url === '/api/ai/settings' && options?.method === 'POST') {
      operations.push('save');
      if (failSave) return response({ error: 'Path tidak valid' }, 400);
      stored = executable;
      return response({ success: true });
    }
    if (url === '/api/ai/settings') return response({ provider: 'codex', desktop, localCli: !desktop, connections: [{ provider: 'codex', model: '', cliPath: stored, executable: stored, configured: true, available: !!stored, apiKeyHint: '' }] });
    if (url === '/api/ai/detect') return response({ available: true, executable });
    if (url === '/api/ai/connect') { operations.push('connect'); return response({ message: 'Login CLI dibuka' }); }
    if (url.startsWith('/api/ai/models')) { operations.push('models'); return response({ models: [{ id: 'synthetic-model', name: 'Synthetic model' }] }); }
    throw new Error('Unexpected test request');
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('enables CLI discovery and Connect for the localhost web profile',async()=>{
  desktop=false;render(<AISettingsModal isOpen onClose={()=>{}}/>);
  await waitFor(()=>expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable));
  expect((screen.getByText('Connect melalui CLI') as HTMLButtonElement).disabled).toBe(false);
});

it('fills the detected CLI executable automatically after opening settings', async () => {
  render(<AISettingsModal isOpen onClose={() => {}} />);
  await waitFor(() => expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable));
  expect(screen.getByText('CLI ditemukan · login dikelola CLI')).toBeTruthy();
});

it('saves a manual folder draft before Connect without requiring a separate Save click', async () => {
  render(<AISettingsModal isOpen onClose={() => {}} />);
  await waitFor(() => expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable));
  fireEvent.change(screen.getByLabelText('CLI executable'), { target: { value: 'C:\\Test\\Codex\\bin\\' } });
  fireEvent.click(screen.getByText('Connect melalui CLI'));
  await screen.findByText('Login CLI dibuka');
  expect(operations).toEqual(['save', 'connect']);
  expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable);
});

it('saves the current provider configuration before requesting models', async () => {
  render(<AISettingsModal isOpen onClose={() => {}} />);
  await waitFor(() => expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable));
  fireEvent.click(screen.getByText('Muat model'));
  await screen.findByText('1 model tersedia');
  expect(operations).toEqual(['save', 'models']);
});

it('does not open a login process if configuration validation fails', async () => {
  render(<AISettingsModal isOpen onClose={() => {}} />);
  await waitFor(() => expect((screen.getByLabelText('CLI executable') as HTMLInputElement).value).toBe(executable));
  failSave = true;
  fireEvent.click(screen.getByText('Connect melalui CLI'));
  await screen.findByText('Path tidak valid');
  expect(operations).toEqual(['save']);
});
