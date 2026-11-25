import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { EncryptJWT } from 'jose';
import { hkdfSync } from 'node:crypto';
import { getDb, closeDb } from '@/lib/db';
import { authHandler } from '@/server/auth/handler';
import { authenticate, getServerSession, requestContext, sessionToken } from '@/server/auth/session';
import { decode, encode, SESSION_MAX_AGE } from '@/server/auth/token';
let directory:string;const origin='http://localhost:3300';const secret='synthetic-auth-secret-for-migration-test';
const cookies=new Map<string,string>();
async function request(endpoint:string,body?:Record<string,unknown>,headers:Record<string,string>={}){
 const response=(await authHandler(new Request(origin+'/api/auth/'+endpoint,{method:body?'POST':'GET',headers:{origin,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),'synthetic-client'))!;
 for(const cookie of response.headers.getSetCookie()){const [name,...value]=cookie.split(';')[0].split('=');cookies.set(name,value.join('='));}return response;
}
beforeEach(async()=>{directory=mkdtempSync(path.join(tmpdir(),'multiplexity-auth-'));vi.stubEnv('DATABASE_PATH',path.join(directory,'db.sqlite'));vi.stubEnv('NEXTAUTH_URL',origin);vi.stubEnv('NEXTAUTH_SECRET',secret);closeDb();cookies.clear();getDb().prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('alice','alice',await bcrypt.hash('synthetic-password-123',4));});
afterEach(()=>{closeDb();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
describe('shared Node authentication',()=>{
 it('rejects missing CSRF, wrong origin, invalid credentials and external redirects',async()=>{
  expect((await request('callback/credentials',{username:'alice',password:'synthetic-password-123'})).status).toBe(403);
  const {csrfToken}=await(await request('csrf')).json();
  expect((await request('callback/credentials',{csrfToken,username:'alice',password:'bad'})).status).toBe(401);
  expect((await request('callback/credentials',{csrfToken,username:'alice',password:'synthetic-password-123'},{origin:'https://evil.example'})).status).toBe(403);
  const response=await request('callback/credentials',{csrfToken,username:'alice',password:'synthetic-password-123',callbackUrl:'https://evil.example'});
  expect(response.status).toBe(200);expect((await response.json()).url).toBe(origin);
  expect((getDb().prepare('SELECT last_login FROM users WHERE id=?').get('alice') as {last_login:string}).last_login).toBeTruthy();
  const session=await(await request('session')).json();expect(session.user).toEqual({id:'alice',name:'alice'});expect(new Date(session.expires).getTime()-Date.now()).toBeGreaterThan((SESSION_MAX_AGE-5)*1000);
  const signout=await request('signout',{csrfToken,callbackUrl:'/login'});expect(signout.status).toBe(200);expect(signout.headers.getSetCookie().some(value=>value.includes('Max-Age=0'))).toBe(true);
  expect(await(await request('session')).json()).toEqual({});
 });
 it('reads legacy encrypted sessions, rejects tampering and revokes them on password changes',async()=>{
  const legacyKey=new Uint8Array(hkdfSync('sha256',secret,'','NextAuth.js Generated Encryption Key',32));
  const legacy=await new EncryptJWT({id:'alice',username:'alice',authVersion:0}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime('8h').encrypt(legacyKey);
  expect((await authenticate('next-auth.session-token='+legacy))?.user.id).toBe('alice');
  expect((await authenticate('__Secure-next-auth.session-token='+legacy))?.user.id).toBe('alice');
  expect(sessionToken('next-auth.session-token.1='+legacy.slice(100)+'; next-auth.session-token.0='+legacy.slice(0,100))).toBe(legacy);
  expect(await authenticate('next-auth.session-token='+legacy.slice(0,-12)+'tamperedxxxx')).toBeNull();
  getDb().prepare('UPDATE users SET auth_version=1 WHERE id=?').run('alice');expect(await authenticate('next-auth.session-token='+legacy)).toBeNull();
 });
 it('keeps concurrent HTTP request identities separate',async()=>{
  getDb().prepare('INSERT INTO users(id,username,password_hash) VALUES (?,?,?)').run('bob','bob','unused');
  const tokens=await Promise.all(['alice','bob'].map(id=>encode({token:{id,authVersion:0},secret})));
  const identities=await Promise.all(tokens.map((token,index)=>requestContext.run(new Request(origin,{headers:{cookie:'next-auth.session-token='+token}}),async()=>{await new Promise(resolve=>setTimeout(resolve,index?1:10));return (await getServerSession())?.user.id;})));
  expect(identities).toEqual(['alice','bob']);expect(await getServerSession()).toBeNull();
 });
 it('uses secure cookies on HTTPS and rejects expired sessions',async()=>{
  vi.stubEnv('NEXTAUTH_URL','https://app.example');const response=await request('csrf');expect(response.headers.getSetCookie()[0]).toContain('__Host-next-auth.csrf-token=');expect(response.headers.getSetCookie()[0]).toContain('Secure');expect(response.headers.getSetCookie()[0]).toContain('HttpOnly');expect(response.headers.getSetCookie()[0]).toContain('SameSite=Lax');
  const token=await encode({token:{id:'alice'},secret,maxAge:-60});await expect(decode({token,secret})).rejects.toThrow();
 });
});
