// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AISettingsModal from '@/components/AISettingsModal';

const path = 'C:/Test/Codex/bin/codex.exe';
const models = [{ id: 'fixture-model', name: 'Fixture model' }];
const saved = vi.fn();
let operations: { url: string; body: Record<string, unknown> }[];
let failure: string;

beforeEach(() => {
  operations = [];
  vi.stubGlobal('React', React);
  failure = '';
  saved.mockReset();
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) { this.open = true; },
    close(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, input?: RequestInit) => {
    operations.push({ url, body: JSON.parse(String(input?.body)) });
    return new Response(JSON.stringify(failure && url === '/api/ai/probe' ? { error: failure } :
      url === '/api/ai/probe' ? { models, executable: path, version: 'codex 0.fixture' } :
        url === '/api/ai/connect' ? { message: 'Login CLI dibuka' } : { success: true }), { status: failure && url === '/api/ai/probe' ? 400 : 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(provider: RegExp, detected = false) {
  render(<AISettingsModal connections={detected ? [{ provider: 'codex', model: '', cliPath: '', executable: path, configured: false, apiKeyHint: '' }] : []}
    makeDefault onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByRole('radio', { name: provider }));
  fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Fixture label' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
}

it('automatically verifies a discovered CLI and saves only after the final action', async () => {
  open(/Codex CLI/, true);
  await screen.findByText(/Koneksi terverifikasi/);
  expect(operations.map(item => item.url)).toEqual(['/api/ai/probe']);
  fireEvent.click(screen.getByRole('button', { name: 'Tambah provider' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('codex'));
  expect(operations[1]?.body).toMatchObject({ provider: 'codex', verify: true, profile: { label: 'Fixture label', models } });
});

it('requires a successful test for manual API configuration', async () => {
  open(/Groq/);
  const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Tambah provider' });
  expect(add.disabled).toBe(true);
  expect(operations).toEqual([]);
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'synthetic-key' } });
  failure = 'API key ditolak';
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByRole('alert');
  expect(add.disabled).toBe(true);
  failure = '';
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Koneksi terverifikasi/);
  fireEvent.change(screen.getByLabelText('Model default'), { target: { value: 'fixture-model' } });
  fireEvent.click(add);
  await waitFor(() => expect(saved).toHaveBeenCalledWith('groq'));
  expect(operations.at(-1)?.body).toMatchObject({ provider: 'groq', model: 'fixture-model', endpoint: 'https://api.groq.com/openai/v1' });
});

it('uses a manual executable to open CLI sign-in without saving the profile', async () => {
  open(/Codex CLI/);
  fireEvent.change(screen.getByLabelText(/Binary path/), { target: { value: path } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka login CLI' }));
  await screen.findByText('Login CLI dibuka');
  expect(operations).toEqual([{ url: '/api/ai/connect', body: expect.objectContaining({ provider: 'codex', cliPath: path }) }]);
  expect(saved).not.toHaveBeenCalled();
});
