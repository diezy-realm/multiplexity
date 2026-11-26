import { Activity, Boxes, Database, GitPullRequest, Network, Server, Plug, ClipboardList, ScanLine, ShieldCheck, Workflow } from 'lucide-react';

export const LIBRARY_APPS = [
  { id: 'vm-machines', name: 'VM Machines', description: 'Akses mesin, terminal SSH, dan log service.', category: 'Sistem & Data', Icon: Server, href: '/', connect: '/?connect=1' },
  { id: 'databases', name: 'Databases', description: 'Kelola koneksi dan data PostgreSQL, MySQL, dan MariaDB.', category: 'Sistem & Data', Icon: Database, href: '/databases', connect: '/databases?connect=1' },
  { id: 'konga', name: 'Konga', description: 'Kelola service dan route melalui Kong Admin API.', category: 'Sistem & Data', Icon: Network, href: '/konga', connect: '/konga?connect=1' },
  { id: 'openshift', name: 'OpenShift', description: 'Jelajahi cluster, workload, dan log pod.', category: 'Sistem & Data', Icon: Boxes, href: '/openshift', connect: '/openshift?connect=1' },
  { id: 'confluent', name: 'Confluent', description: 'Baca metadata Kafka dan Schema Registry.', category: 'Sistem & Data', Icon: Activity, href: '/confluent', connectors: ['confluent'] },
  { id: 'code-review', name: 'Code Review', description: 'Review pull request GitHub Enterprise dan Bitbucket Data Center.', category: 'Developer Tools', Icon: GitPullRequest, href: '/code-review', connectors: ['ghes', 'bitbucket'] },
  { id: 'bamboo', name: 'Bamboo', description: 'Ambil status build dan log CI untuk Evidence Case.', category: 'Developer Tools', Icon: Workflow, connectors: ['bamboo'] },
  { id: 'sonarqube', name: 'SonarQube', description: 'Tinjau hasil quality gate untuk Evidence Case.', category: 'Developer Tools', Icon: ShieldCheck, connectors: ['sonarqube'] },
  { id: 'jira', name: 'Jira', description: 'Kelola draf tindak lanjut untuk Evidence Case.', category: 'Developer Tools', Icon: ClipboardList, connectors: ['jira'] },
  { id: 'checkmarx', name: 'Checkmarx', description: 'Kelola koneksi SCA untuk data temuan yang tersedia.', category: 'Developer Tools', Icon: ScanLine, connectors: ['checkmarx'] },
  { id: 'mcp', name: 'MCP', description: 'Kelola koneksi server MCP, probe, dan tools yang tersedia.', category: 'Developer Tools', Icon: Plug, connectors: [] },
] as const;

export type LibraryApp = typeof LIBRARY_APPS[number];
export type AppConnection = { id: string; label?: string; endpoint?: string; port?: number; account?: string; auth?: string;
  kind?: string; status?: string; enabled?: number; version?: string; checked_at?: string };
export type AppState = { connections: AppConnection[]; ready: boolean; enabled: boolean };
export type LibrarySnapshot = { apps: Record<string, AppState> };
export type LibrarySkill = { id: string; name: string; enabled: boolean; source: 'builtin' | 'workspace' };
export type LibrarySkillDetail = LibrarySkill & { content: string; hash: string };

export function appUrl(app: LibraryApp, settings = false) {
  return (settings ? '/settings?section=apps&app=' : '/library?app=') + app.id;
}

export function launchUrl(app: LibraryApp, state: AppState) {
  if (app.id === 'code-review' && !state.connections.some(item => item.kind === 'ghes' && item.enabled !== 0)) {
    return '/code-review?source=bitbucket';
  }
  return 'href' in app ? app.href : appUrl(app);
}

export async function libraryRequest<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method, signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Library tidak dapat diakses.');
  return data as T;
}
