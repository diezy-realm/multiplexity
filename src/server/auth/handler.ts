import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse, serialize } from 'cookie';
import bcrypt from 'bcrypt';
import { getDb } from '@/lib/db';
import { encode, SESSION_MAX_AGE } from './token';
import { authenticate } from './session';

const attempts = new Map<string, { count: number; expires: number }>();
const options = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NEXTAUTH_URL?.startsWith('https:') === true, path: '/' });
const sessionName = () => options().secure ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
const csrfName = () => options().secure ? '__Host-next-auth.csrf-token' : 'next-auth.csrf-token';
function signature(value: string) { return createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(value).digest('hex'); }
function equal(left: string, right: string) { const a=Buffer.from(left); const b=Buffer.from(right); return a.length === b.length && timingSafeEqual(a,b); }
function callback(value: unknown, origin: string) { try { const url = new URL(typeof value === 'string' ? value : '/', origin); return url.origin === origin ? url.href : origin; } catch { return origin; } }
function clearSession(headers: Headers, cookies: Record<string, string | undefined>) {
  for (const name of new Set([sessionName(), ...Object.keys(cookies).filter(name => /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(name))])) headers.append('Set-Cookie', serialize(name, '', { ...options(), maxAge: 0 }));
}
export async function authHandler(request: Request, client: string): Promise<Response | undefined> {
  const url = new URL(request.url); const action = url.pathname;
  if (!['/api/auth/csrf', '/api/auth/session', '/api/auth/callback/credentials', '/api/auth/signout', '/api/auth/providers'].includes(action)) return;
  const origin = new URL(process.env.NEXTAUTH_URL!).origin;
  const cookies = parse(request.headers.get('cookie') || '');
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (request.method === 'GET' && action === '/api/auth/csrf') {
    const token = randomBytes(32).toString('hex');
    headers.append('Set-Cookie', serialize(csrfName(), token + '|' + signature(token), options()));
    return Response.json({ csrfToken: token }, { headers });
  }
  if (request.method === 'GET' && action === '/api/auth/providers') return Response.json({ credentials: { id:'credentials', name:'Credentials', type:'credentials' } }, { headers });
  if (request.method === 'GET' && action === '/api/auth/session') {
    const session = await authenticate(request.headers.get('cookie'));
    if (session) {
      const token = await encode({ token: { id:session.user.id, username:session.user.name, authVersion:session.authVersion }, secret:process.env.NEXTAUTH_SECRET! });
      clearSession(headers,cookies);
      headers.append('Set-Cookie', serialize(sessionName(), token, { ...options(), maxAge:SESSION_MAX_AGE }));
      session.expires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
    }
    return Response.json(session ? {user:session.user,expires:session.expires} : {}, { headers });
  }
  if (request.method !== 'POST') return Response.json({ error:'Method not allowed' }, { status:405, headers:{...Object.fromEntries(headers),Allow:action.endsWith('/session') || action.endsWith('/csrf') || action.endsWith('/providers') ? 'GET' : 'POST'} });
  if (request.headers.get('origin') !== origin) return Response.json({ error:'Forbidden' }, { status:403, headers });
  let body: Record<string, unknown>;
  try { body = request.headers.get('content-type')?.includes('application/json') ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text())); }
  catch { return Response.json({ error:'Invalid request' }, { status:400, headers }); }
  if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Invalid request'},{status:400,headers});
  const csrf = String(body.csrfToken || '');
  if (!/^[a-f0-9]{64}$/.test(csrf) || !equal(cookies[csrfName()] || '', csrf + '|' + signature(csrf))) return Response.json({ error:'Invalid CSRF token' }, { status:403, headers });
  if (action === '/api/auth/signout') { clearSession(headers,cookies); return Response.json({ url:callback(body.callbackUrl,origin) }, { headers }); }
  const now=Date.now();
  for(const [key,value] of attempts) if(value.expires < now) attempts.delete(key);
  if(attempts.size > 10000) return Response.json({ error:'Try again later' }, { status:429, headers });
  const key=client; const attempt=attempts.get(key) || {count:0,expires:now+15*60*1000};
  if(attempt.count >= 20) return Response.json({ error:'Try again later' }, { status:429, headers });
  attempt.count++; attempts.set(key,attempt);
  if(typeof body.username !== 'string' || body.username.length > 64 || typeof body.password !== 'string' || Buffer.byteLength(body.password) > 72) return Response.json({error:'CredentialsSignin'}, {status:401,headers});
  const user=getDb().prepare('SELECT id, username, password_hash, auth_version FROM users WHERE username = ?').get(body.username) as {id:string;username:string;password_hash:string;auth_version:number}|undefined;
  if(!user || !await bcrypt.compare(body.password,user.password_hash)) return Response.json({error:'CredentialsSignin'}, {status:401,headers});
  attempts.delete(key);
  getDb().prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token=await encode({token:{id:user.id,username:user.username,authVersion:user.auth_version},secret:process.env.NEXTAUTH_SECRET!});
  clearSession(headers,cookies);
  headers.append('Set-Cookie',serialize(sessionName(),token,{...options(),maxAge:SESSION_MAX_AGE}));
  return Response.json({url:callback(body.callbackUrl,origin)},{headers});
}
