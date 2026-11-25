const {test}=require('node:test');const assert=require('node:assert/strict');
const {fork}=require('node:child_process');const {once}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');const path=require('node:path');const os=require('node:os');
test('Electron development shell uses the same local web server and shuts it down',{timeout:180000},async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'multiplexity-electron-dev-'));
 const child=fork(path.resolve('scripts/local-web.cjs'),['--electron','--smoke'],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PORT:'0',MANAGER_DEV_DATA_PATH:directory}});
 let output='';let diagnostics='';child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-10000);});child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-2000);});
 try{const [code]=await once(child,'exit');assert.equal(code,0,diagnostics);assert.match(output,/DESKTOP_DEV_SMOKE_OK/);assert.match(output,/Multiplexity web development: http:\/\/localhost:/);console.log('SHARED_WEB_ELECTRON_DEV_OK');}
 finally{if(child.connected)child.send({type:'shutdown'});rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
