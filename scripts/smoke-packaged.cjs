const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
async function main(){
  const source=path.resolve('release/win-unpacked');
  if(!fs.existsSync(path.join(source,'Multiplexity.exe')))throw new Error('Build desktop:pack first.');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'multiplexity-package-020-'));
  const target=path.join(directory,'app');fs.cpSync(source,target,{recursive:true});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(path.join(target,'Multiplexity.exe'),['--desktop-smoke-test'],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';let diagnostics='';
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
  const timer=setTimeout(()=>child.kill(),240000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  console.log(output);
  if(code!==0||!output.includes('PRIORITIES_UI_SMOKE_OK')||!output.includes('STREAMING_UI_SMOKE_OK'))throw new Error('Packaged smoke failed: '+diagnostics);
  console.log('ISOLATED_MULTIPLEXITY_020_PACKAGE_OK');
  // Keep only diagnostics and screenshots produced by the app, not the copied runtime.
  if(path.dirname(target)!==directory||path.basename(target)!=='app')throw new Error('Invalid temporary runtime path');
  try{await fs.promises.rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:250});}
  catch(error){
    if(!['EBUSY','EPERM','ENOTEMPTY'].includes(error.code))throw error;
    console.warn('Temporary runtime retained because Windows still holds a file lock: '+target);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
