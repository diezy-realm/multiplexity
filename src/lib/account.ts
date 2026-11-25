import { createHash, randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { getDb } from '@/lib/db';
import { getIO } from '@/lib/socket/socket-server';

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72;
}
export function consumeGrant(userId: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const hash = createHash('sha256').update(token).digest('hex');
  return getDb().prepare('DELETE FROM password_grants WHERE token_hash = ? AND user_id = ? AND expires > ?').run(hash, userId, Date.now()).changes === 1;
}
export function createGrant(userId: string) {
  const token = randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO password_grants (token_hash,user_id,expires) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), userId, Date.now() + 300000);
  return token;
}
export async function changePassword(userId: string, password: string) {
  const hash = await bcrypt.hash(password, 12);
  getDb().transaction(() => {
    getDb().prepare('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?').run(hash, userId);
    getDb().prepare('DELETE FROM password_grants WHERE user_id = ?').run(userId);
    getDb().prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(userId);
  })();
  try {
    for (const socket of getIO().sockets.sockets.values()) {
      if (socket.data.userId === userId) socket.disconnect(true);
    }
  } catch { /* Unit tests may not initialize a socket server. */ }
}
export function newChallenge(userId: string, purpose: string, challenge: string, origin: string) {
  getDb().prepare('DELETE FROM auth_challenges WHERE expires < ?').run(Date.now());
  const count = getDb().prepare('SELECT COUNT(*) AS n FROM auth_challenges WHERE user_id = ?').get(userId) as { n: number };
  if (count.n >= 5) throw new Error('Terlalu banyak percobaan. Tunggu beberapa menit.');
  const id = randomUUID();
  getDb().prepare('INSERT INTO auth_challenges (id,user_id,purpose,value,origin,expires) VALUES (?,?,?,?,?,?)').run(id, userId, purpose, challenge, origin, Date.now() + 180000);
  return id;
}
