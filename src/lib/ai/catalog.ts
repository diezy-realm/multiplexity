import { seniorSkills } from './senior-skills';
export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', mode: 'api', keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini' },
  { id: 'claude', name: 'Claude', mode: 'api', keyUrl: 'https://platform.claude.com/settings/keys', defaultModel: '' },
  { id: 'gemini', name: 'Gemini API', mode: 'api', keyUrl: 'https://ai.google.dev/gemini-api/docs/openai', defaultModel: '' },
  { id: 'ollama', name: 'Ollama', mode: 'api', keyUrl: 'https://docs.ollama.com/api/openai-compatibility', defaultModel: '' },
  { id: 'custom', name: 'Custom OpenAI API', mode: 'api', keyUrl: 'https://developers.openai.com/api/docs/api-reference/chat', defaultModel: '' },
  { id: 'codex', name: 'Codex CLI', mode: 'cli', keyUrl: 'https://developers.openai.com/codex/auth', defaultModel: '' },
  { id: 'kiro', name: 'Kiro CLI', mode: 'cli', keyUrl: 'https://kiro.dev/docs/cli/authentication/', defaultModel: '' },
  { id: 'antigravity', name: 'Antigravity CLI', mode: 'cli', keyUrl: 'https://antigravity.google/docs/cli/install/', defaultModel: '' },
] as const;
export type ProviderId = typeof PROVIDERS[number]['id'];
export type Effort = 'default' | 'low' | 'medium' | 'high';
export type Permission = 'read-only' | 'ask' | 'allow-all';
export interface ChatMessage { role: 'user' | 'assistant'; content: string; created_at?: string }
export interface LogSource { vmId: string; kind: 'systemd' | 'docker' | 'file'; target: string; label: string }
export interface ChatAttachment { name: string; content: string; mediaType?: string }
export interface Connection { provider: ProviderId; model: string; configured: boolean; apiKeyHint: string; cliPath: string; endpoint?: string; available?: boolean; executable?: string }
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
