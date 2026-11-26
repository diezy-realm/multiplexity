import { seniorSkills } from './senior-skills';
export const PROVIDERS = [
  { id: 'codex', name: 'Codex CLI', mode: 'cli', keyUrl: 'https://developers.openai.com/codex/auth', defaultModel: '' },
  { id: 'kiro', name: 'Kiro CLI', mode: 'cli', keyUrl: 'https://kiro.dev/docs/cli/authentication/', defaultModel: '' },
  { id: 'antigravity', name: 'Antigravity CLI', mode: 'cli', keyUrl: 'https://antigravity.google/docs/cli/install/', defaultModel: '' },
  { id: 'openai', name: 'OpenAI', mode: 'api', keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini' },
  { id: 'claude', name: 'Claude API', mode: 'api', keyUrl: 'https://platform.claude.com/settings/keys', defaultModel: '' },
  { id: 'gemini', name: 'Gemini API', mode: 'api', keyUrl: 'https://ai.google.dev/gemini-api/docs/openai', defaultModel: '' },
  { id: 'openrouter', name: 'OpenRouter', mode: 'api', keyUrl: 'https://openrouter.ai/docs/api/reference/authentication', defaultModel: '' },
  { id: 'groq', name: 'Groq', mode: 'api', keyUrl: 'https://console.groq.com/docs/openai', defaultModel: '' },
  { id: 'grok', name: 'Grok (xAI)', mode: 'api', keyUrl: 'https://docs.x.ai/developers/rest-api-reference/inference', defaultModel: '' },
  { id: 'ollama', name: 'Ollama', mode: 'api', keyUrl: 'https://docs.ollama.com/api/openai-compatibility', defaultModel: '' },
  { id: 'custom', name: 'OpenAI-Compatible API', mode: 'api', keyUrl: 'https://developers.openai.com/api/docs/api-reference/chat', defaultModel: '' },
] as const;
export type ProviderId = typeof PROVIDERS[number]['id'];
export type ProviderDefinition = typeof PROVIDERS[number];
export const API_ENDPOINTS: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://127.0.0.1:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  grok: 'https://api.x.ai/v1',
};
export type Effort = 'default' | 'low' | 'medium' | 'high';
export type Permission = 'read-only' | 'ask' | 'allow-all';
export interface ChatMessage { role: 'user' | 'assistant'; content: string; created_at?: string }
export interface LogSource { vmId: string; kind: 'systemd' | 'docker' | 'file'; target: string; label: string }
export interface ChatAttachment { name: string; content: string; mediaType?: string }
export interface ProviderModel { id: string; name: string }
export interface ProviderProfile {
  label: string;
  description: string;
  color: string;
  enabled: boolean;
  verified: boolean;
  version: string;
  models: ProviderModel[];
  disabledModels: string[];
}
export interface Connection { provider: ProviderId; model: string; configured: boolean; saved?: boolean; profile?: ProviderProfile; apiKeyHint: string; cliPath: string; endpoint?: string; available?: boolean; executable?: string }
export const SKILLS = [
  ...seniorSkills,
  { id: 'diagnose', label: 'Diagnose', prompt: 'Analisis akar masalah, bukti log, dan langkah verifikasi. Bedakan fakta dan hipotesis.' },
  { id: 'summarize', label: 'Summarize', prompt: 'Ringkas kejadian penting dan urutan waktunya. Sebut sumber dan timestamp.' },
  { id: 'explain', label: 'Explain', prompt: 'Jelaskan log atau error secara ringkas dengan konteks teknis.' },
] as const;
export function isProvider(value: unknown): value is ProviderId { return PROVIDERS.some(provider => provider.id === value); }
export function validModel(value: unknown): value is string { return typeof value === 'string' && value.length <= 120 && /^[a-zA-Z0-9._:/-]*$/.test(value); }
export function supportsEffort(provider: ProviderId, model: string): boolean {
  return ['codex', 'kiro', 'antigravity'].includes(provider) || (provider === 'openai' && /^(gpt-[5-9]|o[134])/.test(model));
}
