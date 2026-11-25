import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { getDb } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto/credential-store';

export type OpenShiftConnection = {
  api_url: string;
  console_url: string;
  token_encrypted: string;
  token_iv: string;
  token_auth_tag: string;
  insecure_tls: number;
};

export type OpenShiftCluster = OpenShiftConnection & {
  id: string;
  user_id: string;
  label: string;
  auth_type: 'oauth_password' | 'token';
  idp: string;
  username: string;
  created_at: string;
  updated_at: string;
};

export interface PodExecSession {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export function validOpenShiftUrl(value: unknown, label = 'URL'): string {
  if (typeof value !== 'string' || value.length > 300) throw new Error(`${label} tidak valid.`);
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /^(169\.254\.|0\.|\[?fe80:|\[?fd00:ec2:)/i.test(url.hostname)
  ) {
    throw new Error(`${label} tidak valid.`);
  }
  return url.toString().replace(/\/$/, '');
}

export function validK8sName(value: string | null | undefined, label = 'Resource'): string {
  if (!value || !/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i.test(value) || value.length > 253) {
    throw new Error(`${label} tidak valid.`);
  }
  return value;
}

export function deriveApiUrlFromConsole(consoleUrl: string): string {
  const url = new URL(consoleUrl);
  const match = url.hostname.match(/^console-openshift-console\.apps\.(.+)$/i);
  if (match) {
    return `https://api.${match[1]}:6443`;
  }
  return consoleUrl;
}

export function deriveOAuthUrlFromConsole(consoleUrl: string): string {
  const url = new URL(consoleUrl);
  const match = url.hostname.match(/^console-openshift-console\.apps\.(.+)$/i);
  if (match) {
    return `https://oauth-openshift.apps.${match[1]}`;
  }
  const apiMatch = url.hostname.match(/^api\.(.+)$/i);
  if (apiMatch) {
    return `https://oauth-openshift.apps.${apiMatch[1]}`;
  }
  return consoleUrl;
}

function migrateLegacyConnection(user: string) {
  const db = getDb();
  const count = (
    db.prepare('SELECT COUNT(*) as c FROM openshift_clusters WHERE user_id = ?').get(user) as { c: number }
  ).c;
  if (count > 0) return;

  const legacy = db
    .prepare(
      'SELECT api_url, console_url, token_encrypted, token_iv, token_auth_tag, insecure_tls FROM openshift_connections WHERE user_id = ?',
    )
    .get(user) as OpenShiftConnection | undefined;
  if (!legacy) return;

  const hostname = (() => {
    try {
      return new URL(legacy.console_url || legacy.api_url).hostname;
    } catch {
      return 'OpenShift Cluster';
    }
  })();

  db.prepare(
    `INSERT INTO openshift_clusters (id, user_id, label, api_url, console_url, auth_type, idp, username, token_encrypted, token_iv, token_auth_tag, insecure_tls)
     VALUES (?, ?, ?, ?, ?, 'token', 'Local Login', '', ?, ?, ?, ?)`,
  ).run(
    randomUUID().replace(/-/g, ''),
    user,
    hostname,
    legacy.api_url,
    legacy.console_url,
    legacy.token_encrypted,
    legacy.token_iv,
    legacy.token_auth_tag,
    legacy.insecure_tls,
  );
}

export function listOpenShiftClusters(user: string): OpenShiftCluster[] {
  migrateLegacyConnection(user);
  return getDb()
    .prepare(
      'SELECT id, user_id, label, api_url, console_url, auth_type, idp, username, token_encrypted, token_iv, token_auth_tag, insecure_tls, created_at, updated_at FROM openshift_clusters WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC',
    )
    .all(user) as OpenShiftCluster[];
}

export function getOpenShiftCluster(user: string, clusterId?: string | null): OpenShiftCluster | undefined {
  migrateLegacyConnection(user);
  const db = getDb();
  if (clusterId) {
    return db
      .prepare(
        'SELECT id, user_id, label, api_url, console_url, auth_type, idp, username, token_encrypted, token_iv, token_auth_tag, insecure_tls, created_at, updated_at FROM openshift_clusters WHERE user_id = ? AND id = ?',
      )
      .get(user, clusterId) as OpenShiftCluster | undefined;
  }
  return db
    .prepare(
      'SELECT id, user_id, label, api_url, console_url, auth_type, idp, username, token_encrypted, token_iv, token_auth_tag, insecure_tls, created_at, updated_at FROM openshift_clusters WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(user) as OpenShiftCluster | undefined;
}

export function saveOpenShiftCluster(
  user: string,
  params: {
    clusterId?: string;
    label: string;
    apiUrl: string;
    consoleUrl: string;
    authType: 'oauth_password' | 'token';
    idp: string;
    username: string;
    token: string;
    insecureTls: boolean;
  },
): OpenShiftCluster {
  const db = getDb();
  const encrypted = encrypt(params.token);
  const id = params.clusterId || randomUUID().replace(/-/g, '');
  const existing = params.clusterId ? getOpenShiftCluster(user, params.clusterId) : undefined;

  if (existing) {
    db.prepare(
      `UPDATE openshift_clusters
       SET label = ?, api_url = ?, console_url = ?, auth_type = ?, idp = ?, username = ?,
           token_encrypted = ?, token_iv = ?, token_auth_tag = ?, insecure_tls = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).run(
      params.label,
      params.apiUrl,
      params.consoleUrl,
      params.authType,
      params.idp,
      params.username,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      params.insecureTls ? 1 : 0,
      id,
      user,
    );
  } else {
    db.prepare(
      `INSERT INTO openshift_clusters (id, user_id, label, api_url, console_url, auth_type, idp, username, token_encrypted, token_iv, token_auth_tag, insecure_tls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      user,
      params.label,
      params.apiUrl,
      params.consoleUrl,
      params.authType,
      params.idp,
      params.username,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      params.insecureTls ? 1 : 0,
    );
  }

  return getOpenShiftCluster(user, id)!;
}

export function deleteOpenShiftCluster(user: string, clusterId: string): boolean {
  const res = getDb()
    .prepare('DELETE FROM openshift_clusters WHERE id = ? AND user_id = ?')
    .run(clusterId, user);
  return res.changes > 0;
}

export function openShiftToken(connection: OpenShiftConnection): string {
  return decrypt({
    ciphertext: connection.token_encrypted,
    iv: connection.token_iv,
    authTag: connection.token_auth_tag,
  });
}

function rawHttpRequest(
  targetUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    insecureTls?: boolean;
    timeoutMs?: number;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const req = client.request(
      parsed,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        rejectUnauthorized: isHttps ? !options.insecureTls : undefined,
        timeout: options.timeoutMs ?? 12000,
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4_000_000) {
            req.destroy(new Error('Respons OpenShift API terlalu besar.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Koneksi ke OpenShift API timeout.')));
    req.on('error', err => reject(err));
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function openshiftRequest<T = unknown>(
  apiUrl: string,
  token: string,
  endpoint: string,
  insecureTls = true,
  expectText = false,
  options?: { method?: string; contentType?: string; body?: unknown },
): Promise<T> {
  const base = validOpenShiftUrl(apiUrl, 'API URL');
  const payload = options?.body !== undefined ? JSON.stringify(options.body) : undefined;
  const res = await rawHttpRequest(`${base}${endpoint}`, {
    method: options?.method ?? 'GET',
    insecureTls,
    body: payload,
    headers: {
      Accept: expectText ? '*/*' : 'application/json',
      ...(payload ? { 'Content-Type': options?.contentType || 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Autentikasi OpenShift ditolak. Periksa token, izin RBAC, atau login ulang.');
    }
    if (res.status === 404) {
      throw new Error('Resource atau endpoint OpenShift tidak ditemukan.');
    }
    let detail = '';
    try {
      const errJson = JSON.parse(res.body) as { message?: string };
      if (errJson.message) detail = `: ${errJson.message}`;
    } catch {
      // ignore non-json error body
    }
    throw new Error(`OpenShift API gagal (${res.status})${detail}`);
  }

  if (expectText) {
    return res.body as T;
  }

  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error('Endpoint bukan JSON Kubernetes/OpenShift API. Gunakan API URL (port 6443), bukan halaman Web Console.');
  }
}

function mergeCookies(jar: Map<string, string>, setCookie?: string | string[]) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const entry of list) {
    const pair = entry.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function extractAccessToken(location?: string): string | null {
  if (!location) return null;
  const hashIndex = location.indexOf('#');
  if (hashIndex === -1) return null;
  const params = new URLSearchParams(location.slice(hashIndex + 1));
  return params.get('access_token');
}

export async function openshiftOAuthLogin(
  apiUrl: string,
  username: string,
  password: string,
  insecureTls = true,
  options?: { consoleUrl?: string; idp?: string },
): Promise<string> {
  const base = validOpenShiftUrl(apiUrl, 'API URL');
  const idp = options?.idp?.trim() || 'Local Login';
  const wellKnown = await rawHttpRequest(`${base}/.well-known/oauth-authorization-server`, {
    insecureTls,
    headers: { Accept: 'application/json' },
  }).catch(() => ({ status: 0, headers: {}, body: '' }));

  let authEndpoint = `${deriveOAuthUrlFromConsole(options?.consoleUrl || base)}/oauth/authorize`;
  if (wellKnown.status >= 200 && wellKnown.status < 300) {
    try {
      const meta = JSON.parse(wellKnown.body) as { authorization_endpoint?: string };
      if (meta.authorization_endpoint) authEndpoint = meta.authorization_endpoint;
    } catch {
      // Fall back to derived oauth-openshift host
    }
  }

  const oauthOrigin = new URL(authEndpoint).origin;
  const authorizePath = `/oauth/authorize?client_id=openshift-challenging-client&response_type=token`;

  const basic = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  const directRes = await rawHttpRequest(`${oauthOrigin}${authorizePath}`, {
    insecureTls,
    headers: {
      Authorization: `Basic ${basic}`,
      'X-CSRF-Token': '1',
    },
  });

  const directToken = extractAccessToken(directRes.headers.location);
  if (directToken) return directToken;

  const jar = new Map<string, string>();
  mergeCookies(jar, directRes.headers['set-cookie']);

  const loginUrl = `${oauthOrigin}/login/${encodeURIComponent(idp)}?then=${encodeURIComponent(authorizePath)}`;
  const loginPage = await rawHttpRequest(loginUrl, {
    insecureTls,
    headers: {
      Accept: 'text/html',
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
  });
  mergeCookies(jar, loginPage.headers['set-cookie']);

  const csrfMatch =
    loginPage.body.match(/name=["']csrf["'][^>]*value=["']([^"']+)["']/i) ||
    loginPage.body.match(/value=["']([^"']+)["'][^>]*name=["']csrf["']/i);
  const csrf = csrfMatch?.[1] || jar.get('csrf') || '';

  const formBody = new URLSearchParams({
    then: authorizePath,
    ...(csrf ? { csrf } : {}),
    username,
    password,
  }).toString();

  let currentUrl = `${oauthOrigin}/login/${encodeURIComponent(idp)}`;
  let currentMethod = 'POST';
  let currentBody: string | undefined = formBody;

  for (let hop = 0; hop < 6; hop++) {
    const res = await rawHttpRequest(currentUrl, {
      method: currentMethod,
      insecureTls,
      body: currentBody,
      headers: {
        ...(currentMethod === 'POST'
          ? {
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: oauthOrigin,
              Referer: loginUrl,
            }
          : {}),
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      },
    });
    mergeCookies(jar, res.headers['set-cookie']);

    const token = extractAccessToken(res.headers.location);
    if (token) return token;

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      currentMethod = 'GET';
      currentBody = undefined;
      continue;
    }

    break;
  }

  throw new Error('Login OpenShift (Local Login) gagal. Periksa username/password atau gunakan Bearer Token.');
}

function decodeK8sExecFrame(buf: Buffer): { channel: number; payload: string } | null {
  if (buf.length < 1) return null;
  return {
    channel: buf[0],
    payload: buf.subarray(1).toString('utf8'),
  };
}

/**
 * Opens an interactive Kubernetes/OpenShift pod exec WebSocket session (`v4.channel.k8s.io`).
 */
export async function openPodExecSession(
  userId: string,
  clusterId: string | undefined,
  namespace: string,
  podName: string,
  container: string | undefined,
  shell: '/bin/sh' | '/bin/bash',
  cols: number,
  rows: number,
  callbacks: {
    onOpen?: () => void;
    onData: (data: string) => void;
    onError: (message: string) => void;
    onClose: () => void;
  },
): Promise<PodExecSession> {
  validK8sName(namespace, 'Project');
  validK8sName(podName, 'Pod');
  if (container) validK8sName(container, 'Container');

  const cluster = getOpenShiftCluster(userId, clusterId);
  if (!cluster) {
    throw new Error('Cluster OpenShift tidak ditemukan.');
  }

  const token = openShiftToken(cluster);
  const safeShell = shell === '/bin/bash' ? '/bin/bash' : '/bin/sh';

  const parsedApi = new URL(cluster.api_url);
  const wsScheme = parsedApi.protocol === 'http:' ? 'ws:' : 'wss:';
  const params = new URLSearchParams({
    stdin: 'true',
    stdout: 'true',
    stderr: 'true',
    tty: 'true',
    command: safeShell,
  });
  if (container) {
    params.set('container', container);
  }

  const execUrl = `${wsScheme}//${parsedApi.host}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${params.toString()}`;

  const ws = new WebSocket(execUrl, ['v4.channel.k8s.io'], {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    rejectUnauthorized: cluster.insecure_tls !== 1,
  });

  let closed = false;

  const sendResize = (w: number, h: number) => {
    if (ws.readyState === WebSocket.OPEN) {
      const resizeJson = JSON.stringify({
        Width: Math.max(10, Math.floor(w || 80)),
        Height: Math.max(4, Math.floor(h || 24)),
      });
      ws.send(Buffer.concat([Buffer.from([4]), Buffer.from(resizeJson, 'utf8')]));
    }
  };

  ws.on('open', () => {
    sendResize(cols, rows);
    callbacks.onOpen?.();
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    const buf = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw as ArrayBuffer);

    const frame = decodeK8sExecFrame(buf);
    if (!frame) return;

    if (frame.channel === 1 || frame.channel === 2) {
      if (frame.payload) callbacks.onData(frame.payload);
    } else if (frame.channel === 3 && frame.payload) {
      try {
        const statusObj = JSON.parse(frame.payload) as { status?: string; message?: string };
        if (statusObj.status && statusObj.status !== 'Success') {
          callbacks.onError(statusObj.message || 'Pod exec selesai dengan error.');
        }
      } catch {
        callbacks.onError(frame.payload);
      }
    }
  });

  ws.on('error', err => {
    if (!closed) callbacks.onError(`Pod exec error: ${err.message}`);
  });

  ws.on('unexpected-response', (_req, res) => {
    if (!closed) {
      callbacks.onError(`Pod exec ditolak cluster (HTTP ${res.statusCode}).`);
      closed = true;
      callbacks.onClose();
    }
  });

  ws.on('close', () => {
    if (!closed) {
      closed = true;
      callbacks.onClose();
    }
  });

  return {
    write: (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.concat([Buffer.from([0]), Buffer.from(data, 'utf8')]));
      }
    },
    resize: sendResize,
    close: () => {
      if (!closed) {
        closed = true;
        try {
          ws.close();
        } catch {
          // ignore close errors
        }
      }
    },
  };
}
