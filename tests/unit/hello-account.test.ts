import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync,rmSync } from 'fs'; import os from 'os'; import path from 'path'; import bcrypt from 'bcrypt';
vi.mock('@/lib/user',()=>({currentUserId:vi.fn(async()=> 'user-a')}));
vi.mock('@simplewebauthn/server',()=>({
  generateRegistrationOptions:vi.fn(async()=>({challenge:'synthetic-registration-challenge'})),
  generateAuthenticationOptions:vi.fn(async()=>({challenge:'synthetic-authentication-challenge'})),
  verifyRegistrationResponse:vi.fn(async()=>({verified:true,registrationInfo:{credential:{id:'credential-a',publicKey:new Uint8Array([1,2,3]),counter:0}}})),
  verifyAuthenticationResponse:vi.fn(async()=>({verified:true,authenticationInfo:{newCounter:1}})),
}));
import { currentUserId } from '@/lib/user';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { closeDb,getDb } from '@/lib/db';
import { POST as hello } from '@/server/routes/auth/hello/route';
import { POST as reset } from '@/server/routes/auth/reset-password/route';
import { POST as account } from '@/server/routes/account/route';
const origin='http://localhost:34567'; let directory:string;
const req=(body:object,requestOrigin=origin)=>new Request(`${origin}/api/auth/hello`,{method:'POST',headers:{origin:requestOrigin},body:JSON.stringify(body)});
beforeEach(async()=>{closeDb();directory=mkdtempSync(path.join(os.tmpdir(),'manager-hello-test-'));vi.stubEnv('DATABASE_PATH',path.join(directory,'test.db'));vi.stubEnv('DESKTOP_MODE','1');vi.stubEnv('NEXTAUTH_URL',origin);vi.mocked(currentUserId).mockResolvedValue('user-a');getDb().prepare('INSERT INTO users (id,username,password_hash) VALUES (?,?,?)').run('user-a','synthetic-user',await bcrypt.hash('synthetic-old-password',4));});
afterEach(()=>{closeDb();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
async function enroll(){const options=await (await hello(req({action:'register-options',password:'synthetic-old-password'}))).json();expect((await hello(req({action:'register-verify',challengeId:options.challengeId,response:{id:'credential-a'}}))).status).toBe(200);}
it('requires current account password before registering a device credential',async()=>{expect((await hello(req({action:'register-options',password:'incorrect'}))).status).toBe(400);expect(getDb().prepare('SELECT id FROM passkeys').all()).toHaveLength(0);});
it('rejects foreign origin and accounts that have not enrolled Windows Hello',async()=>{expect((await hello(req({action:'auth-options',username:'synthetic-user'},'https://example.com'))).status).toBe(403);expect((await hello(req({action:'auth-options',username:'synthetic-user'}))).status).toBe(400);});
it('verifies a one-time challenge and issues a single-use password reset grant',async()=>{
  await enroll(); vi.mocked(currentUserId).mockResolvedValue(undefined as unknown as string);
  const options=await (await hello(req({action:'auth-options',username:'synthetic-user'}))).json();
  const verifyBody={action:'auth-verify',challengeId:options.challengeId,response:{id:'credential-a'}};
  const verified=await hello(req(verifyBody));const data=await verified.json();expect(verified.status).toBe(200);
  expect(vi.mocked(verifyAuthenticationResponse).mock.calls.at(-1)?.[0]).toMatchObject({expectedOrigin:origin,expectedRPID:'localhost',requireUserVerification:true});
  expect((await hello(req(verifyBody))).status).toBe(400);
  const resetBody={username:'synthetic-user',grant:data.grant,newPassword:'synthetic-new-password'};
  expect((await reset(req(resetBody))).status).toBe(200);expect((await reset(req(resetBody))).status).toBe(403);
  const row=getDb().prepare("SELECT password_hash,auth_version FROM users WHERE id='user-a'").get() as {password_hash:string;auth_version:number};
  expect(await bcrypt.compare('synthetic-new-password',row.password_hash)).toBe(true);expect(row.auth_version).toBe(1);
});
it('requires reauthentication to change an account password',async()=>{expect((await account(req({newPassword:'synthetic-new-password'}))).status).toBe(403);expect((await account(req({currentPassword:'synthetic-old-password',newPassword:'synthetic-new-password'}))).status).toBe(200);});
