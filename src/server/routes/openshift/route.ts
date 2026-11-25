import { currentUserId } from '@/lib/user';
import {
  deleteOpenShiftCluster,
  deriveApiUrlFromConsole,
  getOpenShiftCluster,
  listOpenShiftClusters,
  openshiftOAuthLogin,
  openshiftRequest,
  openShiftToken,
  saveOpenShiftCluster,
  validK8sName,
  validOpenShiftUrl,
} from '@/lib/openshift';

const DEFAULT_CONSOLE_URL = 'https://console-openshift-console.apps.ocp-new-dev.bri.co.id';
const DEFAULT_API_URL = 'https://api.ocp-new-dev.bri.co.id:6443';

function failure(error: unknown) {
  const message =
    error instanceof Error && !/fetch failed|abort|timeout|ECONN|ENOTFOUND|CERT/i.test(error.message)
      ? error.message
      : error instanceof Error
        ? `OpenShift API tidak dapat dihubungi (${error.message}). Periksa URL, jaringan, atau opsi Skip TLS.`
        : 'OpenShift API tidak dapat dihubungi.';
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const user = await currentUserId();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const query = new URL(request.url).searchParams;
  const entity = query.get('entity');
  const clusterId = query.get('clusterId');

  if (entity === 'clusters' || entity === 'connection') {
    const clusters = listOpenShiftClusters(user).map(c => ({
      id: c.id,
      label: c.label,
      apiUrl: c.api_url,
      consoleUrl: c.console_url,
      authType: c.auth_type,
      idp: c.idp,
      username: c.username,
      insecureTls: c.insecure_tls === 1,
      hasToken: !!c.token_encrypted,
    }));
    const active = clusterId ? clusters.find(c => c.id === clusterId) ?? clusters[0] : clusters[0];
    return Response.json({
      clusters,
      connected: clusters.length > 0,
      apiUrl: active?.apiUrl || DEFAULT_API_URL,
      consoleUrl: active?.consoleUrl || DEFAULT_CONSOLE_URL,
      hasToken: active?.hasToken ?? false,
      insecureTls: active?.insecureTls ?? true,
    });
  }

  const connection = getOpenShiftCluster(user, clusterId);
  if (!connection) {
    return Response.json({ error: 'Hubungkan OpenShift API terlebih dahulu.' }, { status: 409 });
  }

  const token = openShiftToken(connection);
  const insecure = connection.insecure_tls === 1;

  try {
    if (entity === 'projects') {
      try {
        const res = await openshiftRequest<{ items?: unknown[] }>(
          connection.api_url,
          token,
          '/apis/project.openshift.io/v1/projects',
          insecure,
        );
        return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        const res = await openshiftRequest<{ items?: unknown[] }>(
          connection.api_url,
          token,
          '/api/v1/namespaces',
          insecure,
        );
        return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }

    const project = validK8sName(query.get('project'), 'Project');

    if (entity === 'pods') {
      const res = await openshiftRequest<{ items?: unknown[] }>(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/pods`,
        insecure,
      );
      return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (entity === 'deployments') {
      const [deps, dcs] = await Promise.all([
        openshiftRequest<{ items?: unknown[] }>(
          connection.api_url,
          token,
          `/apis/apps/v1/namespaces/${encodeURIComponent(project)}/deployments`,
          insecure,
        ).catch(() => ({ items: [] })),
        openshiftRequest<{ items?: unknown[] }>(
          connection.api_url,
          token,
          `/apis/apps.openshift.io/v1/namespaces/${encodeURIComponent(project)}/deploymentconfigs`,
          insecure,
        ).catch(() => ({ items: [] })),
      ]);
      return Response.json(
        { items: [...(deps.items ?? []), ...(dcs.items ?? [])] },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (entity === 'configmaps') {
      const res = await openshiftRequest<{ items?: unknown[] }>(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/configmaps`,
        insecure,
      );
      return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (entity === 'configmap') {
      const name = validK8sName(query.get('name'), 'ConfigMap');
      const res = await openshiftRequest(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/configmaps/${encodeURIComponent(name)}`,
        insecure,
      );
      return Response.json({ item: res }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (entity === 'services') {
      const res = await openshiftRequest<{ items?: unknown[] }>(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/services`,
        insecure,
      );
      return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (entity === 'routes') {
      const res = await openshiftRequest<{ items?: unknown[] }>(
        connection.api_url,
        token,
        `/apis/route.openshift.io/v1/namespaces/${encodeURIComponent(project)}/routes`,
        insecure,
      );
      return Response.json({ items: res.items ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (entity === 'logs') {
      const pod = validK8sName(query.get('pod'), 'Pod');
      const container = query.get('container');
      const tail = Math.min(Math.max(Number.parseInt(query.get('tail') || '300', 10) || 300, 10), 2000);
      const containerParam = container ? `&container=${encodeURIComponent(validK8sName(container, 'Container'))}` : '';
      const logs = await openshiftRequest<string>(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/pods/${encodeURIComponent(pod)}/log?tailLines=${tail}${containerParam}`,
        insecure,
        true,
      );
      return Response.json({ logs }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return Response.json({ error: 'Entity tidak valid.' }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  const user = await currentUserId();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      clusterId?: string;
      label?: string;
      apiUrl?: string;
      consoleUrl?: string;
      token?: string;
      username?: string;
      password?: string;
      idp?: string;
      clearToken?: boolean;
      insecureTls?: boolean;
    };

    const consoleUrl = body.consoleUrl ? validOpenShiftUrl(body.consoleUrl, 'Console URL') : DEFAULT_CONSOLE_URL;
    const rawApiUrl = body.apiUrl?.trim() ? body.apiUrl.trim() : deriveApiUrlFromConsole(consoleUrl);
    const apiUrl = validOpenShiftUrl(rawApiUrl, 'API URL');
    const insecureTls = body.insecureTls !== false;
    const previous = body.clusterId ? getOpenShiftCluster(user, body.clusterId) : undefined;
    const idp = body.idp?.trim() || previous?.idp || 'Local Login';

    let token = '';
    let authType: 'oauth_password' | 'token' = 'token';
    const savedUsername = body.username?.trim() || previous?.username || '';

    if (body.username && body.password) {
      authType = 'oauth_password';
      token = await openshiftOAuthLogin(apiUrl, body.username, body.password, insecureTls, {
        consoleUrl,
        idp,
      });
    } else if (!body.clearToken) {
      token =
        body.token?.trim() ||
        (previous && previous.api_url === apiUrl ? openShiftToken(previous) : '');
      authType = previous?.auth_type || 'token';
    }

    if (!token) {
      throw new Error('Masukkan Bearer Token atau Username & Password OpenShift.');
    }

    const projects = await openshiftRequest<{ items?: unknown[] }>(
      apiUrl,
      token,
      '/apis/project.openshift.io/v1/projects?limit=1',
      insecureTls,
    ).catch(() =>
      openshiftRequest<{ items?: unknown[] }>(apiUrl, token, '/api/v1/namespaces?limit=1', insecureTls),
    );

    const defaultLabel = new URL(consoleUrl || apiUrl).hostname;
    const label = body.label?.trim() || previous?.label || defaultLabel;

    const cluster = saveOpenShiftCluster(user, {
      clusterId: body.clusterId,
      label,
      apiUrl,
      consoleUrl,
      authType,
      idp,
      username: savedUsername,
      token,
      insecureTls,
    });

    return Response.json({
      success: true,
      cluster: {
        id: cluster.id,
        label: cluster.label,
        apiUrl: cluster.api_url,
        consoleUrl: cluster.console_url,
        authType: cluster.auth_type,
        idp: cluster.idp,
        username: cluster.username,
        insecureTls: cluster.insecure_tls === 1,
        hasToken: true,
      },
      apiUrl: cluster.api_url,
      consoleUrl: cluster.console_url,
      projectCount: projects.items?.length ?? 0,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const user = await currentUserId();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      clusterId?: string;
      action?: string;
      project?: string;
      name?: string;
      kind?: string;
      data?: Record<string, string | null>;
    };

    const connection = getOpenShiftCluster(user, body.clusterId);
    if (!connection) {
      return Response.json({ error: 'Hubungkan OpenShift API terlebih dahulu.' }, { status: 409 });
    }

    const token = openShiftToken(connection);
    const insecure = connection.insecure_tls === 1;
    const project = validK8sName(body.project, 'Project');
    const name = validK8sName(body.name, 'Resource');

    if (body.action === 'rollout-restart') {
      if (body.kind === 'DeploymentConfig') {
        const result = await openshiftRequest(
          connection.api_url,
          token,
          `/apis/apps.openshift.io/v1/namespaces/${encodeURIComponent(project)}/deploymentconfigs/${encodeURIComponent(name)}/instantiate`,
          insecure,
          false,
          {
            method: 'POST',
            contentType: 'application/json',
            body: {
              kind: 'DeploymentRequest',
              apiVersion: 'apps.openshift.io/v1',
              name,
              latest: true,
              force: true,
            },
          },
        );
        return Response.json({ success: true, result });
      }

      const result = await openshiftRequest(
        connection.api_url,
        token,
        `/apis/apps/v1/namespaces/${encodeURIComponent(project)}/deployments/${encodeURIComponent(name)}`,
        insecure,
        false,
        {
          method: 'PATCH',
          contentType: 'application/strategic-merge-patch+json',
          body: {
            spec: {
              template: {
                metadata: {
                  annotations: {
                    'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                  },
                },
              },
            },
          },
        },
      );
      return Response.json({ success: true, result });
    }

    if (body.action === 'save-configmap') {
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw new Error('Data ConfigMap tidak valid.');
      }
      const cleanData: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(body.data)) {
        if (!/^[-._a-zA-Z0-9]+$/.test(k) || k.length > 253) {
          throw new Error(`Key ConfigMap tidak valid: ${k}`);
        }
        cleanData[k] = v === null ? null : String(v);
      }

      const result = await openshiftRequest(
        connection.api_url,
        token,
        `/api/v1/namespaces/${encodeURIComponent(project)}/configmaps/${encodeURIComponent(name)}`,
        insecure,
        false,
        {
          method: 'PATCH',
          contentType: 'application/merge-patch+json',
          body: { data: cleanData },
        },
      );
      return Response.json({ success: true, item: result });
    }

    return Response.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const user = await currentUserId();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const clusterId = new URL(request.url).searchParams.get('clusterId');
  if (!clusterId) {
    return Response.json({ error: 'clusterId diperlukan.' }, { status: 400 });
  }

  const deleted = deleteOpenShiftCluster(user, clusterId);
  return Response.json({ success: deleted });
}
