import { hkdfSync, randomUUID } from 'node:crypto';
import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';

export const SESSION_MAX_AGE = 8 * 60 * 60;
function key(secret: string) {
  if (!secret) throw new Error('Missing authentication secret');
  // Preserve the existing v4 JWE format so framework migration does not invalidate sessions.
  return new Uint8Array(hkdfSync('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32));
}
export async function encode({ token = {}, secret, maxAge = SESSION_MAX_AGE }: { token?: JWTPayload; secret: string; maxAge?: number }) {
  return new EncryptJWT(token).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + maxAge).setJti(randomUUID()).encrypt(key(secret));
}
export async function decode({ token, secret }: { token?: string; secret: string }): Promise<JWTPayload | null> {
  if (!token) return null;
  return (await jwtDecrypt(token, key(secret), { clockTolerance: 15, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] })).payload;
}
