import { getDb } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto/credential-store';

export type KongConnection = { admin_url: string; token_encrypted: string; token_iv: string; token_auth_tag: string };
export function validAdminUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) throw new Error('Admin URL tidak valid.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /^(169\.254\.|0\.|\[?fe80:|\[?fd00:ec2:)/i.test(url.hostname)) throw new Error('Admin URL tidak valid.');
  return url.toString().replace(/\/$/, '');
}
export function getKongConnection(user: string) {
  return getDb().prepare('SELECT admin_url,token_encrypted,token_iv,token_auth_tag FROM kong_connections WHERE user_id = ?').get(user) as KongConnection | undefined;
}
export function saveKongConnection(user: string, url: string, token: string) {
  const encrypted = encrypt(token);
  getDb().prepare('INSERT INTO kong_connections (user_id,admin_url,token_encrypted,token_iv,token_auth_tag) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET admin_url=excluded.admin_url,token_encrypted=excluded.token_encrypted,token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag').run(user,url,encrypted.ciphertext,encrypted.iv,encrypted.authTag);
}
export function connectionToken(connection: KongConnection) {
  return decrypt({ciphertext:connection.token_encrypted,iv:connection.token_iv,authTag:connection.token_auth_tag});
}
export async function kongRequest(url: string, token: string, endpoint: string, method = 'GET', body?: object) {
  const response = await fetch(`${validAdminUrl(url)}${endpoint}`, {method,redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store',headers:{Accept:'application/json',...(body ? {'Content-Type':'application/json'} : {}),...(token ? {'Kong-Admin-Token':token} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Akses Admin API ditolak. Periksa token.' : response.status === 400 || response.status === 409 ? 'Kong menolak data. Periksa nama unik, upstream, dan route.' : `Admin API gagal (${response.status}).`);
  if (response.status === 204) return {success:true};
  const text = await response.text(); if (text.length > 2000000) throw new Error('Respons Admin API terlalu besar.');
  try { return JSON.parse(text); } catch { throw new Error('Endpoint bukan JSON Kong Admin API. Gunakan Admin URL, bukan halaman Konga.'); }
}
export function entityData(entity: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Data tidak valid.');
  const data = value as Record<string, unknown>;
  if (typeof data.name !== 'string' || !/^[a-zA-Z0-9._~-]{1,128}$/.test(data.name)) throw new Error('Nama hanya boleh berisi huruf, angka, titik, garis, dan underscore.');
  if (entity === 'services') {
    if (typeof data.url !== 'string' || data.url.length > 500) throw new Error('Upstream URL tidak valid.');
    const url = new URL(data.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Gunakan upstream HTTP/HTTPS tanpa kredensial atau query.');
    return {name:data.name,protocol:url.protocol.slice(0,-1),host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port || (url.protocol === 'https:' ? 443 : 80)),path:url.pathname === '/' ? null : url.pathname};
  }
  const strings = (key: string, pattern: RegExp, required = false) => {
    const items = data[key];
    if (!Array.isArray(items) || items.length > 32 || (required && !items.length) || items.some(item=>typeof item !== 'string' || item.length > 256 || !pattern.test(item))) throw new Error(`${key} tidak valid.`);
    return items;
  };
  const paths = strings('paths', /^\/(?!.*[\r\n]).*$/);
  const hosts = strings('hosts', /^[a-zA-Z0-9*.-]+$/);
  if (!paths.length && !hosts.length) throw new Error('Isi minimal satu path atau host.');
  if (typeof data.serviceId !== 'string' || !/^[a-zA-Z0-9._~-]{1,128}$/.test(data.serviceId)) throw new Error('Pilih service.');
  if (typeof data.strip_path !== 'boolean' || typeof data.preserve_host !== 'boolean') throw new Error('Opsi route tidak valid.');
  return {name:data.name,service:{id:data.serviceId},paths:paths.length ? paths : null,hosts:hosts.length ? hosts : null,strip_path:data.strip_path,preserve_host:data.preserve_host};
}
