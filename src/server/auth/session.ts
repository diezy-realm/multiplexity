import { AsyncLocalStorage } from 'node:async_hooks';
import { parse } from 'cookie';
import { getDb } from '@/lib/db';
import { decode } from './token';
import type { Socket } from 'socket.io';

export interface Session { user: { id: string; name: string }; expires: string; authVersion: number }
export const requestContext = new AsyncLocalStorage<Request>();
export function sessionToken(header?: string | null): string | undefined {
  const cookies = parse(header || '');
  for (const name of ['__Secure-next-auth.session-token', 'next-auth.session-token']) {
    if (cookies[name]) return cookies[name];
    const parts = Object.keys(cookies).filter(key => key.startsWith(name + '.') && /^\d+$/.test(key.slice(name.length + 1))).sort((a,b) => Number(a.slice(name.length + 1)) - Number(b.slice(name.length + 1)));
    if (parts.length) return parts.map(key => cookies[key]).join('');
  }
}
export async function authenticate(header?: string | null): Promise<Session | null> {
  try {
    const token = await decode({ token: sessionToken(header), secret: process.env.NEXTAUTH_SECRET || '' });
    if (!token || typeof token.id !== 'string' || typeof token.exp !== 'number') return null;
    const user = getDb().prepare('SELECT username, auth_version FROM users WHERE id = ?').get(token.id) as { username: string; auth_version: number } | undefined;
    if (!user || user.auth_version !== (token.authVersion ?? 0)) return null;
    return { user: { id: token.id, name: user.username }, expires: new Date(token.exp * 1000).toISOString(), authVersion:user.auth_version };
  } catch { return null; }
}
export async function getServerSession(): Promise<Session | null> {
  return authenticate(requestContext.getStore()?.headers.get('cookie'));
}
export async function authenticateSocket(socket:Socket,next:(error?:Error)=>void){
  if(!socket.handshake.headers.cookie)return next(new Error('Authentication required: no cookies'));
  if(!sessionToken(socket.handshake.headers.cookie))return next(new Error('Authentication required: no session token'));
  if(!process.env.NEXTAUTH_SECRET)return next(new Error('Server configuration error: missing secret'));
  const session=await authenticate(socket.handshake.headers.cookie);
  if(!session)return next(new Error('Authentication failed: invalid session'));
  socket.data={userId:session.user.id,username:session.user.name};next();
}
