import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os'; import path from 'path';
vi.mock('@/lib/user',()=>({currentUserId:vi.fn(async()=> 'account-a')}));
import { currentUserId } from '@/lib/user';
import { getDb, closeDb } from '@/lib/db';
import { GET, PUT, POST, PATCH, DELETE } from '@/server/routes/konga/route';
import { entityData, validAdminUrl } from '@/lib/kong';
let directory:string;
const request=(body:object)=>new Request('http://localhost/api/konga',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{closeDb();directory=mkdtempSync(path.join(os.tmpdir(),'manager-kong-test-'));vi.stubEnv('DATABASE_PATH',path.join(directory,'test.db'));vi.stubEnv('DESKTOP_MODE','1');vi.stubEnv('ENCRYPTION_KEY','a'.repeat(64));vi.mocked(currentUserId).mockResolvedValue('account-a');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({version:'1.5.0',data:[]}),{status:200})));});
afterEach(()=>{closeDb();vi.unstubAllEnvs();vi.unstubAllGlobals();rmSync(directory,{recursive:true,force:true});});
it('verifies an Admin API before saving, encrypts tokens, and isolates connections by account',async()=>{
  expect((await PUT(request({adminUrl:'http://127.0.0.1:8001',token:'synthetic-admin-token'}))).status).toBe(200);
  expect(JSON.stringify(getDb().prepare('SELECT * FROM kong_connections').all())).not.toContain('synthetic-admin-token');
  expect(JSON.stringify(await(await GET(new Request('http://localhost/api/konga?entity=connection'))).json())).not.toContain('synthetic-admin-token');
  vi.mocked(currentUserId).mockResolvedValue('account-b');expect((await GET(new Request('http://localhost/api/konga?entity=services'))).status).toBe(409);
});
it('creates, updates, paginates, and deletes only allowlisted Kong entities',async()=>{
  await PUT(request({adminUrl:'http://127.0.0.1:8001',token:''}));
  const payload={entity:'services',data:{name:'synthetic',url:'http://127.0.0.1:4000'}};
  expect((await POST(request(payload))).status).toBe(200);
  expect((await PATCH(request({...payload,id:'service-id'}))).status).toBe(200);
  expect((await GET(new Request('http://localhost/api/konga?entity=routes&offset=a%2Fb'))).status).toBe(200);
  expect((await DELETE(request({entity:'routes',id:'route-id'}))).status).toBe(200);
  expect((await DELETE(request({entity:'plugins',id:'x'}))).status).toBe(400);
  expect((await PATCH(request({...payload,id:'../outside'}))).status).toBe(400);
  expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).includes('offset=a%2Fb'))).toBe(true);
});
it('rejects non-Admin endpoints and unsafe or incomplete fields',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Konga</html>'));
  expect((await PUT(request({adminUrl:'http://127.0.0.1',token:''}))).status).toBe(400);
  for(const url of ['file:///secret','http://name:password@localhost:8001','http://169.254.169.254']) expect(()=>validAdminUrl(url)).toThrow();
  expect(()=>entityData('routes',{name:'test',serviceId:'id',paths:[],hosts:[],strip_path:true,preserve_host:false})).toThrow();
  expect(entityData('routes',{name:'test',serviceId:'id',paths:['/test'],hosts:[],strip_path:true,preserve_host:false})).toMatchObject({paths:['/test'],service:{id:'id'}});
  expect(entityData('services',{name:'test',url:'https://example.com/upstream'})).toEqual({name:'test',protocol:'https',host:'example.com',port:443,path:'/upstream'});
});
it('supports authenticated web accounts and rejects anonymous requests',async()=>{vi.stubEnv('DESKTOP_MODE','');expect((await GET(new Request('http://localhost/api/konga?entity=connection'))).status).toBe(200);vi.mocked(currentUserId).mockResolvedValue(undefined);expect((await GET(new Request('http://localhost/api/konga?entity=connection'))).status).toBe(401);});
