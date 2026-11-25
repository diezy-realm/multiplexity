import https from 'https';
import http from 'http';

export async function providerRequest(url: string, headers: Record<string, string>, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname))) { reject(new Error('Endpoint harus HTTPS atau HTTP localhost.')); return; }
    const request = (target.protocol === 'http:' ? http : https).request(url, {
      method: encoded ? 'POST' : 'GET',
      headers: { ...headers, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) },
      rejectUnauthorized: true,
      signal,
    }, response => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { request.destroy(new Error('Respons provider terlalu besar.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Provider HTTP ${response.statusCode ?? 502}. Periksa kredensial, model, kuota, dan izin akun.`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Format respons provider tidak valid.')); }
      });
    });
    request.on('error', error => reject(new Error(error.name === 'AbortError' ? 'Permintaan dibatalkan.' : 'Koneksi provider gagal. Periksa jaringan dan sertifikat TLS.')));
    request.setTimeout(120000, () => request.destroy(new Error('Provider timeout.')));
    request.end(encoded);
  });
}
