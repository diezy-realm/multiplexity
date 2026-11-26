import { API_ENDPOINTS, type Connection, type ProviderDefinition, type ProviderId, type ProviderModel } from './catalog';

export interface Identity {
  label: string;
  color: string;
  description: string;
}

export interface RuntimeConfig {
  cliPath: string;
  endpoint: string;
  apiKey: string;
  clearKey: boolean;
}

export interface ProviderSettings {
  provider: ProviderId;
  connections: Connection[];
}

export interface ProbeResult {
  executable: string;
  version: string;
  models: ProviderModel[];
}

export const providerSettingsEvent = 'ai-settings-updated';

export function runtimeConfig(definition: ProviderDefinition, connection?: Connection): RuntimeConfig {
  return {
    cliPath: connection?.cliPath ?? '',
    endpoint: connection?.endpoint || API_ENDPOINTS[definition.id] || '',
    apiKey: '',
    clearKey: false,
  };
}

export function editableEndpoint(provider: ProviderId) {
  return provider === 'custom' || provider === 'gemini' || provider === 'ollama';
}

export function mergeModels(...lists: ProviderModel[][]) {
  const models = new Map<string, ProviderModel>();
  for (const list of lists) {
    for (const model of list) if (model.id && !models.has(model.id)) models.set(model.id, model);
  }
  return [...models.values()].slice(0, 300);
}

export function enabledProvider(connection?: Connection) {
  return connection?.profile?.enabled !== false;
}

export async function providerFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan provider gagal.');
  return data as T;
}

export function providerWrite<T>(url: string, body: object, method = 'POST', signal?: AbortSignal) {
  return providerFetch<T>(url, { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
