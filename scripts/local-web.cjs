const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {fork,spawn}=require('node:child_process');

function developmentEnvironment(input=process.env,root=path.resolve(__dirname,'..')) {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==22||minor<12)throw new Error('Development memerlukan Node.js 22.12 atau lebih baru pada major 22.');
  const port=Number(input.PORT??3300);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT harus berupa angka 0–65535.');
  const directory=path.resolve(input.MANAGER_DEV_DATA_PATH||path.join(root,'.local-dev'));
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Folder data development tidak boleh berupa symlink.');
  const file=path.join(directory,'runtime-secrets.json');
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('File secrets tidak boleh berupa symlink.');
  if(!fs.existsSync(file)){
    try{fs.writeFileSync(file,JSON.stringify({encryptionKey:randomBytes(32).toString('hex'),authSecret:randomBytes(32).toString('hex')}),{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const secrets=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!/^[a-f0-9]{64}$/.test(secrets.encryptionKey)||!/^[a-f0-9]{64}$/.test(secrets.authSecret))throw new Error('Secrets development tidak valid; jangan menggantinya jika data sudah tersimpan.');
  return {...input,NODE_ENV:'development',DESKTOP_MODE:'0',MANAGER_LOCAL_DEV:'1',PORT:String(port),NEXTAUTH_URL:`http://localhost:${port}`,NEXTAUTH_URL_INTERNAL:`http://localhost:${port}`,DATABASE_PATH:path.join(directory,'dashboard.db'),MANAGER_DATA_PATH:directory,ENCRYPTION_KEY:secrets.encryptionKey,NEXTAUTH_SECRET:secrets.authSecret};
}
function start(){
  if(!process.argv.includes('--production'))require('./generate-routes.cjs');
  const root=path.resolve(__dirname,'..');
  const environment=process.argv.includes('--production')?{...process.env,NODE_ENV:'production',MANAGER_LOCAL_DEV:'0',DESKTOP_MODE:'0'}:developmentEnvironment();
  const production=process.argv.includes('--production');
  const child=fork(path.join(root,production?'dist/server/server.cjs':'server.ts'),[],{cwd:root,execArgv:production?[]:['--import','tsx'],env:environment,stdio:['inherit','inherit','inherit','ipc']});
  let stopping=false;let desktop;
  const stop=()=>{if(stopping)return;stopping=true;desktop?.kill();if(child.connected)child.send({type:'shutdown'});else child.kill();const timer=setTimeout(()=>child.kill(),10000);timer.unref();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  if(process.send){process.on('message',message=>{if(message?.type==='shutdown')stop();});process.once('disconnect',stop);}
  child.on('message',message=>{
    if(message?.type==='ready'){
      console.log(`> Multiplexity web development: ${message.origin}`);process.send?.(message);
      if(process.argv.includes('--electron')){
        const desktopEnvironment={...process.env,NODE_ENV:'development',MANAGER_DEV_ORIGIN:message.origin,MANAGER_DEV_DATA_PATH:environment.MANAGER_DATA_PATH};
        for(const name of ['ELECTRON_RUN_AS_NODE','ENCRYPTION_KEY','NEXTAUTH_SECRET','DESKTOP_ACCESS_TOKEN'])delete desktopEnvironment[name];
        desktop=spawn(require('electron'),[path.join(root,'desktop/dev.cjs'),...(process.argv.includes('--smoke')?['--dev-smoke']:[]),...(process.argv.includes('--composer-smoke')?['--composer-smoke']:[])],{cwd:root,env:desktopEnvironment,stdio:'inherit',windowsHide:process.argv.includes('--smoke')});
        desktop.once('error',()=>{console.error('Gagal membuka Electron development.');process.exitCode=1;stop();});
        desktop.once('exit',code=>{if(code)process.exitCode=code;stop();});
      }
    }
    if(message?.type==='cli-login')require('../desktop/cli-login.cjs').openCliLogin(message);
  });
  child.once('error',()=>{console.error('Gagal menjalankan server development.');process.exitCode=1;});
  child.once('exit',code=>{desktop?.kill();process.exitCode=process.exitCode||(code??(stopping?0:1));if(process.connected)process.disconnect();});
}
module.exports={developmentEnvironment};
if(require.main===module){try{start();}catch(error){console.error(error.message);process.exitCode=1;}}
