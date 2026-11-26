'use client';
import { useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import { PageActions } from '@/components/PageHeader';
import Select from '@/components/Select';
import Dialog from '@/components/Dialog';
import ConfirmDialog, { type Confirmation } from '@/components/ConfirmDialog';
import OpenshiftLogsModal from '@/components/OpenshiftLogsModal';

const OpenshiftTerminalModal = lazy(() => import('@/components/OpenshiftTerminalModal'));

type ResourceKind = 'pods' | 'deployments' | 'configmaps' | 'services' | 'routes';

interface ClusterSummary {
  id: string;
  label: string;
  apiUrl: string;
  consoleUrl: string;
  authType: 'oauth_password' | 'token';
  idp: string;
  username: string;
  insecureTls: boolean;
  hasToken: boolean;
}

interface K8sMetadata {
  name: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
}

interface PodItem {
  metadata: K8sMetadata;
  spec?: {
    nodeName?: string;
    containers?: { name: string; image?: string }[];
  };
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    containerStatuses?: {
      name: string;
      ready?: boolean;
      restartCount?: number;
      state?: Record<string, { reason?: string }>;
    }[];
  };
}

interface DeploymentItem {
  kind?: string;
  metadata: K8sMetadata;
  spec?: {
    replicas?: number;
    strategy?: { type?: string };
    template?: { spec?: { containers?: { name: string; image?: string }[] } };
  };
  status?: {
    readyReplicas?: number;
    replicas?: number;
    availableReplicas?: number;
  };
}

interface ConfigMapItem {
  metadata: K8sMetadata;
  data?: Record<string, string>;
}

interface ServiceItem {
  metadata: K8sMetadata;
  spec?: {
    type?: string;
    clusterIP?: string;
    ports?: { name?: string; port: number; targetPort?: number | string; protocol?: string }[];
    selector?: Record<string, string>;
  };
}

interface RouteItem {
  metadata: K8sMetadata;
  spec?: {
    host?: string;
    path?: string;
    to?: { kind?: string; name?: string };
    port?: { targetPort?: number | string };
    tls?: { termination?: string };
  };
}

type ResourceItem = PodItem & DeploymentItem & ConfigMapItem & ServiceItem & RouteItem;

const field = 'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm';
const button = 'border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-xs disabled:opacity-40 inline-flex items-center gap-1.5 hover:bg-gray-100 dark:hover:bg-gray-800';

const RESOURCE_TABS: { id: ResourceKind; label: string }[] = [
  { id: 'pods', label: 'Pods' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'configmaps', label: 'ConfigMaps' },
  { id: 'services', label: 'Services' },
  { id: 'routes', label: 'Routes' },
];

function podBadge(pod: PodItem): { label: string; cls: string } {
  const waitingReason = pod.status?.containerStatuses?.find(c => c.state?.waiting?.reason)?.state?.waiting?.reason;
  const phase = waitingReason || pod.status?.phase || 'Unknown';
  if (phase === 'Running' || phase === 'Succeeded') {
    return { label: phase, cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' };
  }
  if (phase === 'Pending' || phase === 'ContainerCreating') {
    return { label: phase, cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' };
  }
  return { label: phase, cls: 'bg-red-500/15 text-red-500 border-red-500/30' };
}

export default function OpenshiftPage() {
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<string>('');
  const [editingClusterId, setEditingClusterId] = useState<string | undefined>(undefined);

  const [label, setLabel] = useState('OCP New Dev BRI');
  const [consoleUrl, setConsoleUrl] = useState('https://console-openshift-console.apps.ocp-new-dev.bri.co.id');
  const [apiUrl, setApiUrl] = useState('https://api.ocp-new-dev.bri.co.id:6443');
  const [authMode, setAuthMode] = useState<'token' | 'credentials'>('credentials');
  const [idp, setIdp] = useState('Local Login');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [insecureTls, setInsecureTls] = useState(true);
  const [params] = useSearchParams();
  const connectFromLibrary = params.get('connect') === '1';
  const connectOnInitialLoad = useRef(connectFromLibrary);
  const [connectionOpen, setConnectionOpen] = useState(connectFromLibrary);

  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [kind, setKind] = useState<ResourceKind>('pods');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [snackbar, setSnackbar] = useState('');

  const [detailItem, setDetailItem] = useState<ResourceItem | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [cmEntries, setCmEntries] = useState<{ key: string; value: string }[]>([]);
  const [cmDeletedKeys, setCmDeletedKeys] = useState<string[]>([]);
  const [cmNewKey, setCmNewKey] = useState('');
  const [cmSaving, setCmSaving] = useState(false);
  const [cmError, setCmError] = useState('');

  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [logTarget, setLogTarget] = useState<{ pod: string; containers: string[] } | null>(null);
  const [execTarget, setExecTarget] = useState<{ pod: string; containers: string[] } | null>(null);

  const activeCluster = clusters.find(c => c.id === activeClusterId) ?? clusters[0];
  const connected = clusters.length > 0;

  useEffect(() => {
    if (!snackbar) return;
    const timer = window.setTimeout(() => setSnackbar(''), 3500);
    return () => window.clearTimeout(timer);
  }, [snackbar]);

  const populateFormFromCluster = useCallback((cluster?: ClusterSummary) => {
    if (!cluster) {
      setEditingClusterId(undefined);
      setLabel('OCP New Dev BRI');
      setConsoleUrl('https://console-openshift-console.apps.ocp-new-dev.bri.co.id');
      setApiUrl('https://api.ocp-new-dev.bri.co.id:6443');
      setAuthMode('credentials');
      setIdp('Local Login');
      setUsername('');
      setPassword('');
      setToken('');
      setHasToken(false);
      setInsecureTls(true);
      return;
    }
    setEditingClusterId(cluster.id);
    setLabel(cluster.label);
    setConsoleUrl(cluster.consoleUrl);
    setApiUrl(cluster.apiUrl);
    setAuthMode(cluster.authType === 'token' ? 'token' : 'credentials');
    setIdp(cluster.idp || 'Local Login');
    setUsername(cluster.username || '');
    setPassword('');
    setToken('');
    setHasToken(cluster.hasToken);
    setInsecureTls(cluster.insecureTls);
  }, []);

  const loadClusters = useCallback(async () => {
    const res = await fetch('/api/openshift?entity=clusters');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const list = (data.clusters ?? []) as ClusterSummary[];
    setClusters(list);
    if (list.length > 0) {
      setActiveClusterId(prev => (prev && list.some(c => c.id === prev) ? prev : list[0].id));
      setConnectionOpen(connectOnInitialLoad.current);
    } else {
      setActiveClusterId('');
      setConnectionOpen(true);
    }
    connectOnInitialLoad.current = false;
    return list;
  }, []);

  const loadProjects = useCallback(async (targetClusterId = activeClusterId) => {
    if (!targetClusterId) return [];
    const res = await fetch(`/api/openshift?entity=projects&clusterId=${encodeURIComponent(targetClusterId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const names = ((data.items ?? []) as { metadata?: { name?: string } }[])
      .map(item => item.metadata?.name || '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setProjects(names);
    setProject(prev => (prev && names.includes(prev) ? prev : names[0] || ''));
    return names;
  }, [activeClusterId]);

  const loadResources = useCallback(
    async (targetProject = project, targetKind = kind, targetClusterId = activeClusterId) => {
      if (!targetClusterId || !targetProject) {
        setItems([]);
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        const res = await fetch(
          `/api/openshift?entity=${targetKind}&clusterId=${encodeURIComponent(targetClusterId)}&project=${encodeURIComponent(targetProject)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setItems((data.items ?? []) as ResourceItem[]);
      } catch (error) {
        setItems([]);
        setMessage(error instanceof Error ? error.message : 'Gagal memuat resource OpenShift.');
      } finally {
        setBusy(false);
      }
    },
    [activeClusterId, project, kind],
  );

  useEffect(() => {
    void loadClusters().catch(error => {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat daftar cluster.');
    });
  }, [loadClusters]);

  useEffect(() => {
    if (!activeClusterId) return;
    setProjects([]);
    setProject('');
    setItems([]);
    void loadProjects(activeClusterId).catch(error => {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat project.');
    });
  }, [activeClusterId, loadProjects]);

  useEffect(() => {
    if (activeClusterId && project) {
      void loadResources(project, kind, activeClusterId);
    }
  }, [activeClusterId, project, kind, loadResources]);

  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const payload =
        authMode === 'credentials'
          ? { clusterId: editingClusterId, label, apiUrl, consoleUrl, username, password, idp, insecureTls }
          : { clusterId: editingClusterId, label, apiUrl, consoleUrl, token, insecureTls };
      const res = await fetch('/api/openshift', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken('');
      setPassword('');
      setConnectionOpen(false);
      await loadClusters();
      window.dispatchEvent(new Event("library-apps-changed"));
      if (data.cluster?.id) {
        setActiveClusterId(data.cluster.id);
      }
      setSnackbar(`Cluster ${data.cluster?.label || label} terhubung!`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Koneksi gagal.');
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteCluster(cluster: ClusterSummary) {
    setConfirmation({
      title: 'Hapus Cluster',
      target: cluster.label,
      description: 'Hapus konfigurasi cluster OpenShift ini dari akun Anda?',
      action: async () => {
        const res = await fetch(`/api/openshift?clusterId=${encodeURIComponent(cluster.id)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menghapus cluster.');
        setSnackbar(`Cluster ${cluster.label} dihapus.`);
        await loadClusters();
        window.dispatchEvent(new Event("library-apps-changed"));
      },
    });
  }

  function openDetail(item: ResourceItem) {
    setDetailItem(item);
    setShowRawJson(false);
    setCmError('');
    setCmNewKey('');
    setCmDeletedKeys([]);
    if (kind === 'configmaps') {
      setCmEntries(Object.entries(item.data ?? {}).map(([key, value]) => ({ key, value })));
    }
  }

  async function reloadConfigMap(name: string) {
    if (!project || !activeClusterId) return;
    setCmSaving(true);
    setCmError('');
    try {
      const res = await fetch(
        `/api/openshift?entity=configmap&clusterId=${encodeURIComponent(activeClusterId)}&project=${encodeURIComponent(project)}&name=${encodeURIComponent(name)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const refreshed = data.item as ResourceItem;
      setDetailItem(refreshed);
      setCmEntries(Object.entries(refreshed.data ?? {}).map(([key, value]) => ({ key, value })));
      setCmDeletedKeys([]);
      setSnackbar('ConfigMap dimuat ulang!');
      await loadResources(project, 'configmaps', activeClusterId);
    } catch (err) {
      setCmError(err instanceof Error ? err.message : 'Gagal memuat ulang ConfigMap.');
    } finally {
      setCmSaving(false);
    }
  }

  async function saveConfigMap(name: string) {
    if (!project || !activeClusterId) return;
    setCmSaving(true);
    setCmError('');
    try {
      const payloadData: Record<string, string | null> = {};
      for (const delKey of cmDeletedKeys) {
        payloadData[delKey] = null;
      }
      for (const entry of cmEntries) {
        if (!entry.key.trim()) continue;
        payloadData[entry.key.trim()] = entry.value;
      }

      const res = await fetch('/api/openshift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterId: activeClusterId,
          action: 'save-configmap',
          project,
          name,
          data: payloadData,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setDetailItem(result.item as ResourceItem);
      setCmDeletedKeys([]);
      setSnackbar('ConfigMap berhasil disimpan!');
      await loadResources(project, 'configmaps', activeClusterId);
    } catch (err) {
      setCmError(err instanceof Error ? err.message : 'Gagal menyimpan ConfigMap.');
    } finally {
      setCmSaving(false);
    }
  }

  function requestRolloutRestart(item: DeploymentItem) {
    const depName = item.metadata.name;
    const depKind = item.kind === 'DeploymentConfig' ? 'DeploymentConfig' : 'Deployment';
    setConfirmation({
      title: 'Restart Rollout',
      target: `${project} / ${depName}`,
      description: `Lakukan rollout restart pada ${depKind} ini? Semua pod akan di-recreate secara bertahap.`,
      action: async () => {
        const res = await fetch('/api/openshift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusterId: activeClusterId,
            action: 'rollout-restart',
            project,
            name: depName,
            kind: depKind,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSnackbar(`Rollout restart ${depName} dimulai!`);
        await loadResources(project, 'deployments', activeClusterId);
      },
    });
  }

  const filteredItems = items.filter(item =>
    JSON.stringify([
      item.metadata?.name,
      item.spec?.host,
      item.status?.phase,
      item.spec?.clusterIP,
    ])
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {confirmation && (
        <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(undefined)} />
      )}

      <PageActions>
        <div className="flex gap-2">
          <a
            href={activeCluster?.consoleUrl || consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={button}
          >
            Buka Console
            <ArrowUpRight aria-hidden="true" size={13} />
          </a>
          <button
            type="button"
            className={button}
            onClick={() => {
              populateFormFromCluster(undefined);
              setConnectionOpen(true);
            }}
          >
            <Plus aria-hidden="true" size={13} />
            Tambah Cluster
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              if (connectionOpen) {
                setConnectionOpen(false);
              } else {
                populateFormFromCluster(activeCluster);
                setConnectionOpen(true);
              }
            }}
          >
            Koneksi
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !connected || !project}
            onClick={() => void loadResources(project, kind, activeClusterId)}
          >
            <RefreshCw aria-hidden="true" size={13} className={busy ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </PageActions>

      {connectionOpen && (
        <form
          onSubmit={event => {
            event.preventDefault();
            void connect();
          }}
          className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 grid gap-3 max-w-xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {editingClusterId ? 'Edit Cluster OpenShift' : 'Tambah Cluster OpenShift'}
            </h2>
            {editingClusterId && activeCluster && (
              <button
                type="button"
                onClick={() => requestDeleteCluster(activeCluster)}
                className={`${button} text-red-400`}
              >
                <Trash2 aria-hidden="true" size={13} />
                Hapus Cluster
              </button>
            )}
          </div>

          <label className="text-sm">
            Nama / Label Cluster
            <input
              aria-label="Label Cluster"
              type="text"
              required
              className={`${field} mt-1`}
              value={label}
              onChange={event => setLabel(event.target.value)}
              placeholder="OCP New Dev BRI"
            />
          </label>
          <label className="text-sm">
            Web Console URL
            <input
              aria-label="OpenShift Console URL"
              type="url"
              required
              className={`${field} mt-1`}
              value={consoleUrl}
              onChange={event => setConsoleUrl(event.target.value)}
              placeholder="https://console-openshift-console.apps.ocp-new-dev.bri.co.id"
            />
          </label>
          <label className="text-sm">
            Cluster API URL (opsional, otomatis dari Console URL)
            <input
              aria-label="OpenShift API URL"
              type="url"
              className={`${field} mt-1 font-mono`}
              value={apiUrl}
              onChange={event => setApiUrl(event.target.value)}
              placeholder="https://api.ocp-new-dev.bri.co.id:6443"
            />
          </label>

          <div role="tablist" aria-label="Metode login OpenShift" className="panel-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'credentials'}
              onClick={() => setAuthMode('credentials')}
              className="panel-tab text-xs"
            >
              Local Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'token'}
              onClick={() => setAuthMode('token')}
              className="panel-tab text-xs"
            >
              Bearer Token
            </button>
          </div>

          {authMode === 'token' ? (
            <label className="text-sm">
              Bearer Token (`oc whoami -t`)
              <input
                aria-label="OpenShift Bearer Token"
                type="password"
                autoComplete="off"
                className={`${field} mt-1 font-mono`}
                value={token}
                onChange={event => setToken(event.target.value)}
                placeholder={hasToken ? 'Token tersimpan (kosongkan untuk pertahankan)' : 'sha256~...'}
              />
            </label>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm">
                Identity Provider
                <input
                  aria-label="OpenShift Identity Provider"
                  type="text"
                  required
                  className={`${field} mt-1`}
                  value={idp}
                  onChange={event => setIdp(event.target.value)}
                  placeholder="Local Login"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  Username
                  <input
                    aria-label="OpenShift Username"
                    type="text"
                    required
                    autoComplete="username"
                    className={`${field} mt-1`}
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Password
                  <input
                    aria-label="OpenShift Password"
                    type="password"
                    required={!hasToken}
                    autoComplete="current-password"
                    className={`${field} mt-1`}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder={hasToken ? 'Kosongkan untuk pertahankan token' : ''}
                  />
                </label>
              </div>
            </div>
          )}

          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={insecureTls}
              onChange={event => setInsecureTls(event.target.checked)}
            />
            Skip verifikasi sertifikat TLS (direkomendasikan untuk cluster internal)
          </label>

          <button type="submit" disabled={busy} className={`${button} justify-self-start bg-blue-600 text-white border-transparent`}>
            {busy ? 'Menghubungkan…' : 'Hubungkan'}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        {clusters.length > 0 && (
          <div className="w-52 flex items-center gap-2">
            <Server aria-hidden="true" size={14} className="text-gray-400 shrink-0" />
            <Select
              aria-label="Cluster OpenShift"
              value={activeClusterId}
              disabled={busy}
              onChange={event => setActiveClusterId(event.target.value)}
              className={field}
            >
              {clusters.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="w-52">
          <Select
            aria-label="Project OpenShift"
            value={project}
            disabled={!connected || !projects.length || busy}
            onChange={event => setProject(event.target.value)}
            className={field}
          >
            {!projects.length && <option value="">Pilih Project</option>}
            {projects.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        <div role="tablist" aria-label="Resource OpenShift" className="panel-tabs">
          {RESOURCE_TABS.map(tab => (
            <button
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              key={tab.id}
              onClick={() => {
                setKind(tab.id);
                setSearch('');
              }}
              className="panel-tab text-xs"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          aria-label="Cari resource OpenShift"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Cari…"
          className={`${field} max-w-xs ml-auto`}
        />
      </div>

      <p role="status" className="text-sm text-gray-500">
        {busy ? 'Memuat…' : message}
      </p>

      <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {filteredItems.map(item => {
          const name = item.metadata?.name || '';
          const badge = kind === 'pods' ? podBadge(item) : null;
          const containers = (item.spec?.containers ?? []).map(c => c.name);
          const restarts =
            kind === 'pods'
              ? (item.status?.containerStatuses ?? []).reduce((sum, c) => sum + (c.restartCount ?? 0), 0)
              : 0;
          const routeHref =
            kind === 'routes' && item.spec?.host
              ? `${item.spec?.tls ? 'https' : 'http'}://${item.spec.host}${item.spec.path || ''}`
              : '';

          return (
            <div
              key={`${kind}-${name}`}
              className="flex flex-wrap gap-3 p-4 items-center hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <button
                type="button"
                onClick={() => openDetail(item)}
                className="flex-1 min-w-0 text-left focus:outline-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-sm font-medium truncate hover:text-blue-400 transition-colors">{name}</h2>
                  {badge && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                  {kind === 'routes' && item.spec?.tls && (
                    <span className="shrink-0 rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400">
                      TLS ({item.spec.tls.termination || 'edge'})
                    </span>
                  )}
                </div>

                <p className="text-xs text-gray-500 font-mono break-all mt-1">
                  {kind === 'pods' &&
                    `IP: ${item.status?.podIP || '-'} · Node: ${item.spec?.nodeName || '-'} · Restarts: ${restarts}`}
                  {kind === 'deployments' &&
                    `Ready: ${item.status?.readyReplicas ?? 0}/${item.spec?.replicas ?? item.status?.replicas ?? 0} · Strategy: ${item.spec?.strategy?.type || 'RollingUpdate'}`}
                  {kind === 'configmaps' &&
                    `${Object.keys(item.data ?? {}).length} keys: ${Object.keys(item.data ?? {}).slice(0, 6).join(', ') || '-'}`}
                  {kind === 'services' &&
                    `${item.spec?.type || 'ClusterIP'} · ${item.spec?.clusterIP || '-'} · Ports: ${(item.spec?.ports ?? []).map(p => `${p.port}->${p.targetPort ?? p.port}/${p.protocol ?? 'TCP'}`).join(', ') || '-'}`}
                  {kind === 'routes' &&
                    `${routeHref || '-'} → ${item.spec?.to?.name || '-'}`}
                </p>
              </button>

              {kind === 'routes' && routeHref && (
                <a
                  href={routeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={button}
                >
                  Buka
                  <ArrowUpRight aria-hidden="true" size={13} />
                </a>
              )}
              {kind === 'pods' && (
                <>
                  <button
                    type="button"
                    onClick={() => setLogTarget({ pod: name, containers })}
                    className={button}
                  >
                    <FileText aria-hidden="true" size={13} />
                    Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecTarget({ pod: name, containers })}
                    className={button}
                  >
                    <Terminal aria-hidden="true" size={13} />
                    Exec
                  </button>
                </>
              )}
              {kind === 'deployments' && (
                <button type="button" onClick={() => requestRolloutRestart(item)} className={button}>
                  <RotateCw aria-hidden="true" size={13} />
                  Restart Rollout
                </button>
              )}
              <button type="button" onClick={() => openDetail(item)} className={button}>
                <FileText aria-hidden="true" size={13} />
                {kind === 'configmaps' ? 'Edit / Detail' : 'Detail'}
              </button>
            </div>
          );
        })}

        {!filteredItems.length && (
          <p className="p-8 text-sm text-gray-500">
            {connected
              ? 'Belum ada resource di project ini.'
              : 'Hubungkan OpenShift API untuk melihat Pods, Deployments, ConfigMaps, Services, dan Routes.'}
          </p>
        )}
      </div>

      {logTarget && (
        <OpenshiftLogsModal
          clusterId={activeClusterId}
          project={project}
          pod={logTarget.pod}
          containers={logTarget.containers}
          onClose={() => setLogTarget(null)}
        />
      )}

      {execTarget && (
        <Suspense fallback={null}>
          <OpenshiftTerminalModal
            clusterId={activeClusterId}
            project={project}
            pod={execTarget.pod}
            containers={execTarget.containers}
            onClose={() => setExecTarget(null)}
          />
        </Suspense>
      )}

      {detailItem && (
        <Dialog
          title={`${kind === 'configmaps' ? 'ConfigMap' : 'Detail'} — ${detailItem.metadata?.name}`}
          onClose={() => setDetailItem(null)}
          className="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700 pb-3">
              <div className="flex flex-wrap gap-3 font-mono">
                <span>Namespace: <strong className="text-gray-200">{detailItem.metadata?.namespace || project}</strong></span>
                {detailItem.metadata?.creationTimestamp && (
                  <span>Created: <strong className="text-gray-200">{new Date(detailItem.metadata.creationTimestamp).toLocaleString()}</strong></span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {kind === 'deployments' && (
                  <button
                    type="button"
                    onClick={() => requestRolloutRestart(detailItem)}
                    className={button}
                  >
                    <RotateCw aria-hidden="true" size={13} />
                    Restart Rollout
                  </button>
                )}
                {kind === 'configmaps' && (
                  <button
                    type="button"
                    disabled={cmSaving}
                    onClick={() => void reloadConfigMap(detailItem.metadata.name)}
                    className={button}
                  >
                    <RefreshCw aria-hidden="true" size={13} className={cmSaving ? 'animate-spin' : ''} />
                    Reload
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRawJson(v => !v)}
                  className={button}
                >
                  {showRawJson ? 'Ringkasan' : 'Raw JSON'}
                </button>
              </div>
            </div>

            {showRawJson ? (
              <pre className="max-h-[60dvh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(detailItem, null, 2)}
              </pre>
            ) : kind === 'configmaps' ? (
              <div className="space-y-4">
                {cmError && (
                  <p role="alert" className="text-xs text-red-400">
                    {cmError}
                  </p>
                )}
                <div className="space-y-3 max-h-[52dvh] overflow-y-auto pr-1">
                  {cmEntries.map((entry, idx) => (
                    <div key={entry.key} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-semibold text-blue-400">{entry.key}</span>
                        <button
                          type="button"
                          aria-label={`Hapus key ${entry.key}`}
                          onClick={() => {
                            setCmDeletedKeys(prev => [...prev, entry.key]);
                            setCmEntries(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="icon-action text-red-400 hover:text-red-300"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      </div>
                      <textarea
                        aria-label={`Value ${entry.key}`}
                        rows={Math.min(Math.max(entry.value.split('\n').length, 2), 10)}
                        value={entry.value}
                        onChange={e =>
                          setCmEntries(prev =>
                            prev.map((row, i) => (i === idx ? { ...row, value: e.target.value } : row)),
                          )
                        }
                        className="ui-field w-full font-mono text-xs"
                      />
                    </div>
                  ))}
                  {!cmEntries.length && (
                    <p className="text-xs text-gray-500">ConfigMap ini belum memiliki key data.</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <input
                    aria-label="Key baru"
                    value={cmNewKey}
                    onChange={e => setCmNewKey(e.target.value)}
                    placeholder="Key baru (mis. application.properties)"
                    className="ui-field flex-1 min-w-[200px] font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={!cmNewKey.trim() || cmEntries.some(e => e.key === cmNewKey.trim())}
                    onClick={() => {
                      setCmEntries(prev => [...prev, { key: cmNewKey.trim(), value: '' }]);
                      setCmDeletedKeys(prev => prev.filter(k => k !== cmNewKey.trim()));
                      setCmNewKey('');
                    }}
                    className={button}
                  >
                    <Plus aria-hidden="true" size={13} />
                    Tambah Key
                  </button>
                  <button
                    type="button"
                    disabled={cmSaving}
                    onClick={() => void saveConfigMap(detailItem.metadata.name)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-40 ml-auto"
                  >
                    <Save aria-hidden="true" size={13} />
                    {cmSaving ? 'Menyimpan…' : 'Simpan'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {kind === 'pods' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                      <p className="text-gray-400">Status & Network</p>
                      <p className="font-mono">Phase: {detailItem.status?.phase || '-'}</p>
                      <p className="font-mono">Pod IP: {detailItem.status?.podIP || '-'}</p>
                      <p className="font-mono">Host IP: {detailItem.status?.hostIP || '-'}</p>
                      <p className="font-mono">Node: {detailItem.spec?.nodeName || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                      <p className="text-gray-400">Containers</p>
                      {(detailItem.spec?.containers ?? []).map(c => (
                        <p key={c.name} className="font-mono break-all">
                          {c.name}: {c.image}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {kind === 'deployments' && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-1.5 font-mono">
                    <p>Kind: {detailItem.kind || 'Deployment'}</p>
                    <p>Replicas: {detailItem.status?.readyReplicas ?? 0} ready / {detailItem.spec?.replicas ?? 0} desired</p>
                    <p>Strategy: {detailItem.spec?.strategy?.type || 'RollingUpdate'}</p>
                    {(detailItem.spec?.template?.spec?.containers ?? []).map(c => (
                      <p key={c.name} className="break-all">Container {c.name}: {c.image}</p>
                    ))}
                  </div>
                )}

                {kind === 'services' && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-1.5 font-mono">
                    <p>Type: {detailItem.spec?.type || 'ClusterIP'}</p>
                    <p>Cluster IP: {detailItem.spec?.clusterIP || '-'}</p>
                    <p>Ports: {(detailItem.spec?.ports ?? []).map(p => `${p.name || ''} ${p.port}->${p.targetPort ?? p.port}/${p.protocol ?? 'TCP'}`).join(', ') || '-'}</p>
                    {detailItem.spec?.selector && (
                      <p>Selector: {Object.entries(detailItem.spec.selector).map(([k, v]) => `${k}=${v}`).join(', ')}</p>
                    )}
                  </div>
                )}

                {kind === 'routes' && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-1.5 font-mono">
                    <p>Host: {detailItem.spec?.host || '-'}</p>
                    <p>Path: {detailItem.spec?.path || '/'}</p>
                    <p>Target: {detailItem.spec?.to?.kind || 'Service'} / {detailItem.spec?.to?.name || '-'}</p>
                    <p>TLS: {detailItem.spec?.tls?.termination || 'None'}</p>
                  </div>
                )}

                {detailItem.metadata?.labels && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-gray-400 mb-2">Labels</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(detailItem.metadata.labels).map(([k, v]) => (
                        <span key={k} className="rounded-md bg-gray-100 dark:bg-gray-700 px-2 py-0.5 font-mono">
                          {k}={v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog>
      )}

      {snackbar && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{snackbar}</span>
        </div>
      )}
    </div>
  );
}
