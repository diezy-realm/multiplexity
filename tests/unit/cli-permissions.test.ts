import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { EventEmitter } from 'events';import { PassThrough } from 'stream';import fs from 'fs';import os from 'os';import path from 'path';
const {calls}=vi.hoisted(()=>({calls:[] as {args:string[];cwd:string;policy?:Record<string,unknown>}[]}));
vi.mock('child_process',()=>({spawn:vi.fn((_executable:string,args:string[],options:{cwd:string})=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
  const settings=args.indexOf('--settings');const policy=settings>=0?JSON.parse(fs.readFileSync(args[settings+1],'utf8')):undefined;
  calls.push({args,cwd:options.cwd,policy});
  child.stdin.on('finish',()=>{queueMicrotask(()=>{
    if(args.includes('--help'))child.stderr.write('Usage: --settings JSON --dangerously-skip-permissions');
    else if(args[0]==='exec')child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'synthetic response'}})+'\n');
    else if(args[0]==='chat')child.stdout.write('synthetic response');
    else child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'synthetic response'}})+'\n');
    child.emit('close',0);
  });});return child;
})}));
import {runCli} from '@/lib/ai/cli';
let directory:string;
beforeEach(()=>{calls.length=0;directory=fs.mkdtempSync(path.join(os.tmpdir(),'manager-cli-permissions-'));vi.stubEnv('MANAGER_DATA_PATH',directory);});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(directory,{recursive:true,force:true});});
it('detects agy --settings when Go prints help only on stderr',async()=>{
  expect(await runCli('antigravity','synthetic','', 'default','prompt',undefined,'','read-only','test')).toBe('synthetic response');
  const run=calls.find(c=>c.policy)!;expect(run.policy).toEqual({toolPermission:'strict'});expect(run.policy).not.toHaveProperty('mcpServers');expect(run.args).toContain('--sandbox');
});
it.each(['codex','kiro','antigravity'] as const)('uses concrete Allow All flags for %s',async provider=>{
  await runCli(provider,'synthetic','','default','prompt',undefined,'','allow-all','test');
  const flag=provider==='codex'?'--dangerously-bypass-approvals-and-sandbox':provider==='kiro'?'--trust-all-tools':'--dangerously-skip-permissions';
  expect(calls.some(c=>c.args.includes(flag))).toBe(true);
  if(provider==='antigravity')expect(calls.find(c=>c.policy)?.policy?.toolPermission).toBe('always-proceed');
});
it('reuses one persistent workspace across providers',async()=>{
  await runCli('codex','synthetic','','default','prompt',undefined,'','read-only','test');
  await runCli('kiro','synthetic','','default','prompt',undefined,'','read-only','test');
  expect(calls[0].cwd).toBe(calls[1].cwd);expect(fs.existsSync(path.join(calls[0].cwd,'rules.md'))).toBe(true);
});
it('passes Codex image paths as arguments and removes temporary images after completion',async()=>{
 await runCli('codex','synthetic','','default','prompt',undefined,'','read-only','test',[{name:'clipboard.png',mediaType:'image/png',content:'iVBORw0KGgo='}]);
 const args=calls[0].args;const index=args.indexOf('--image');
 expect(index).toBeGreaterThan(-1);expect(args[index+1]).toMatch(/multiplexity-image-.*\.png$/);
 expect(fs.existsSync(args[index+1])).toBe(false);
});
