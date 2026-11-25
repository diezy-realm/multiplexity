import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'fs';import os from 'os';import path from 'path';
import {isLocalDevelopment,canUseLocalCli,hasLocalWebAccess} from '@/lib/runtime';
import {closeDb} from '@/lib/db';
import {GET,POST} from '@/server/routes/auth/desktop-setup/route';
let directory:string;
beforeEach(()=>{directory=mkdtempSync(path.join(os.tmpdir(),'multiplexity-local-runtime-'));vi.stubEnv('NODE_ENV','development');vi.stubEnv('MANAGER_LOCAL_DEV','1');vi.stubEnv('DESKTOP_MODE','0');vi.stubEnv('NEXTAUTH_URL','http://localhost:3300');vi.stubEnv('DATABASE_PATH',path.join(directory,'test.db'));closeDb();});
afterEach(()=>{closeDb();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
const request=(body?:object,headers:Record<string,string>={})=>new Request('http://localhost:3300/api/auth/desktop-setup',{method:body?'POST':'GET',headers:{host:'localhost:3300',origin:'http://localhost:3300','Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
it('enables local capabilities only in the explicit localhost development profile',()=>{
 expect(isLocalDevelopment()).toBe(true);expect(canUseLocalCli()).toBe(true);
 vi.stubEnv('NODE_ENV','production');expect(isLocalDevelopment()).toBe(false);expect(canUseLocalCli()).toBe(false);
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('NEXTAUTH_URL','http://192.0.2.1:3300');expect(isLocalDevelopment()).toBe(false);
 vi.stubEnv('DESKTOP_MODE','1');expect(canUseLocalCli()).toBe(true);
});
it('rejects forged hosts and cross-origin requests',()=>{
 expect(hasLocalWebAccess(request())).toBe(true);
 expect(hasLocalWebAccess(new Request('http://127.0.0.1:3300/api/auth/desktop-setup',{headers:{host:'localhost:3300',origin:'http://localhost:3300'}}))).toBe(true);
 expect(hasLocalWebAccess(request(undefined,{host:'example.com'}))).toBe(false);
 expect(hasLocalWebAccess(request(undefined,{origin:'https://example.com'}))).toBe(false);
});
it('creates the first local web account once and never exposes setup in production',async()=>{
 expect((await(await GET(request())).json()).setupRequired).toBe(true);
 const body={username:'local-test',password:'synthetic-local-password'};
 expect((await POST(request(body,{origin:'https://example.com'}))).status).toBe(403);
 expect((await POST(request(body))).status).toBe(201);
 expect((await POST(request(body))).status).toBe(409);
 vi.stubEnv('NODE_ENV','production');expect((await GET(request())).status).toBe(404);
});
