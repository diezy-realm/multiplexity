import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import os from 'os'; import path from 'path';
vi.mock('@/lib/user', () => ({ currentUserId: vi.fn(async()=> 'user-a') }));
import { currentUserId } from '@/lib/user';
import { getDb, closeDb } from '@/lib/db';
import { GET, POST } from '@/server/routes/snippets/route';
import { workspaceRoot, writeWorkspace, readWorkspace, listWorkspace, workspaceFile, downloadWorkspace,artifactVersions,artifactVersion,contentHash } from '@/lib/ai/workspace';
import { executeWorkspaceTool } from '@/lib/ai/workspace-tools';
let directory: string;
beforeEach(()=>{ closeDb(); directory=mkdtempSync(path.join(os.tmpdir(),'manager-vault-test-')); vi.stubEnv('DATABASE_PATH',path.join(directory,'test.db')); vi.stubEnv('MANAGER_DATA_PATH',directory); vi.stubEnv('ENCRYPTION_KEY','a'.repeat(64)); vi.mocked(currentUserId).mockResolvedValue('user-a'); });
afterEach(()=>{ closeDb(); vi.unstubAllEnvs(); rmSync(directory,{recursive:true,force:true}); });
const req=(body:object)=>new Request('http://localhost/api/snippets',{method:'POST',body:JSON.stringify(body)});
it('keeps bounded account-isolated versions and rejects stale writes without changing the file',()=>{
 const name='artifacts/versioned.md';writeWorkspace('user-a',name,'first');const hash=contentHash('first');
 writeWorkspace('user-a',name,'second',hash);
 expect(()=>writeWorkspace('user-a',name,'lost update',hash)).toThrow('File telah berubah');
 expect(readWorkspace('user-a',name)).toBe('second');
 const versions=artifactVersions('user-a',name) as {id:string}[];
 expect(versions).toHaveLength(2);expect(artifactVersion('user-a',name,versions[1].id).content).toBe('first');
 expect(()=>artifactVersion('user-b',name,versions[1].id)).toThrow();
 for(let index=0;index<22;index++)writeWorkspace('user-a',name,'revision '+index);
 expect(artifactVersions('user-a',name)).toHaveLength(20);
});
it('encrypts snippets and never includes their contents in the list or agent workspace',async()=>{
  const response=await POST(req({title:'Synthetic credential',kind:'credential',content:'synthetic-vault-secret'})); const {id}=await response.json();
  expect(response.status).toBe(200);
  expect(JSON.stringify(await (await GET(new Request('http://localhost/api/snippets'))).json())).not.toContain('synthetic-vault-secret');
  expect(JSON.stringify(getDb().prepare('SELECT * FROM snippets').all())).not.toContain('synthetic-vault-secret');
  expect((await (await GET(new Request(`http://localhost/api/snippets?id=${id}`))).json()).content).toBe('synthetic-vault-secret');
  const root=workspaceRoot('user-a'); expect(existsSync(path.join(root,'dashboard.db'))).toBe(false);
  vi.mocked(currentUserId).mockResolvedValue('user-b'); expect((await GET(new Request(`http://localhost/api/snippets?id=${id}`))).status).toBe(404);
});
it('shares the same instructions and artifacts across providers, isolated by account',()=>{
  expect(workspaceRoot('user-a')).toBe(workspaceRoot('user-a'));
  writeWorkspace('user-a','artifacts/result.md','Synthetic analysis');
  expect(readWorkspace('user-a','artifacts/result.md')).toBe('Synthetic analysis');
  expect(listWorkspace('user-a').files.map(f=>f.name)).toEqual(expect.arrayContaining(['AGENTS.md','rules.md','steering.md','skills/diagnose.md','artifacts/result.md']));
  expect(()=>readWorkspace('user-b','artifacts/result.md')).toThrow();
});
it('rejects traversal and credential configuration paths',()=>{
  const root=workspaceRoot('user-a');
  for(const file of ['../outside.md','artifacts/../../outside.md','.env','config.json','C:\\secret.md','artifacts/config.json']) expect(()=>workspaceFile(root,file)).toThrow();
});
it('lists and downloads binary deliverables without treating them as editable text',()=>{
  const root=workspaceRoot('user-a'); const bytes=Buffer.from([0,1,2,255]);
  writeFileSync(path.join(root,'artifacts','result.pdf'),bytes);
  expect(listWorkspace('user-a').files.some(file=>file.name==='artifacts/result.pdf')).toBe(true);
  expect(Buffer.from(downloadWorkspace('user-a','artifacts/result.pdf'))).toEqual(bytes);
  expect(()=>readWorkspace('user-a','artifacts/result.pdf')).toThrow();
  expect(()=>writeWorkspace('user-a','artifacts/result.pdf','invalid')).toThrow();
});
it('allows API artifact writes only when Allow All is selected',()=>{
  const args={name:'artifacts/tool-output.md',content:'output'};
  expect(executeWorkspaceTool('user-a','read-only','write_artifact',args)).toContain('error');
  expect(executeWorkspaceTool('user-a','allow-all','write_artifact',args)).toContain('saved');
  expect(readWorkspace('user-a',args.name)).toBe('output');
  expect(executeWorkspaceTool('user-a','allow-all','write_artifact',{name:'rules.md',content:'unsafe'})).toContain('error');
});
