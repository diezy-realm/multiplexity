const {test}=require('node:test');const assert=require('node:assert/strict');
const {fork}=require('node:child_process');const {once}=require('node:events');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
test('composer: rendered web UI through Electron, payload, keyboard, themes, embedded and HTTP streaming',{timeout:180000},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'multiplexity-composer-ui-'));
  const env={...process.env,PORT:'0',MANAGER_DEV_DATA_PATH:directory};delete env.ELECTRON_RUN_AS_NODE;
  const child=fork(path.resolve('scripts/local-web.cjs'),['--electron','--smoke','--composer-smoke'],{env,stdio:['ignore','pipe','pipe','ipc']});
  let output='';let diagnostics='';child.stdout.on('data',chunk=>{output=(output+chunk).slice(-12000);});child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
  try{
    const [code]=await once(child,'exit');assert.equal(code,0,diagnostics+'\n'+output);
    assert.match(output,/COMPOSER_UI_SMOKE_OK/);assert.match(output,/STREAMING_UI_SMOKE_OK/);
    console.log(output);console.log('COMPOSER_UI_ARTIFACTS',directory);
  }finally{if(child.connected)child.send({type:'shutdown'});}
});
