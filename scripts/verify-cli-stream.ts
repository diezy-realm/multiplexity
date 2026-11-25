import fs from 'fs';
import os from 'os';
import path from 'path';
import { findCli,runCli } from '../src/lib/ai/cli';

async function main(){
  const provider=process.argv[2];if(provider!=='codex' && provider!=='antigravity')throw new Error('Specify codex or antigravity.');
  const executable=findCli(provider,'');if(!executable)throw new Error('CLI not installed.');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'multiplexity-stream-probe-'));
  process.env.MANAGER_DATA_PATH=directory;
  let deltas=0;let statuses=0;
  try{
    const answer=await runCli(provider,executable,'','default','Reply only with OK. Do not run tools.',AbortSignal.timeout(45000),'','read-only','synthetic-probe',[],event=>{if(event.type==='delta')deltas++;else statuses++;});
    console.log('CLI_STREAM_PROBE_OK',JSON.stringify({provider,receivedAnswer:!!answer.trim(),deltas,statuses}));
  }finally{
    const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('multiplexity-stream-probe-'))throw new Error('Unsafe cleanup path.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
main().catch(()=>{console.error('CLI_STREAM_PROBE_FAILED');process.exitCode=1;});
