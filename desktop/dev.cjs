const {app,BrowserWindow,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const origin=process.env.MANAGER_DEV_ORIGIN;
let url;
try{url=new URL(origin);}catch{console.error('Jalankan npm run desktop:dev.');app.exit(1);}
if(!url||app.isPackaged||process.env.NODE_ENV!=='development'||url.protocol!=='http:'||url.hostname!=='localhost'||url.origin!==origin||!process.env.MANAGER_DEV_DATA_PATH){app.exit(1);}
else{
  const directory=path.join(process.env.MANAGER_DEV_DATA_PATH,'electron');
  fs.mkdirSync(directory,{recursive:true});app.setPath('userData',directory);app.setName('Multiplexity Development');
  app.whenReady().then(async()=>{
    const smoke=process.argv.includes('--dev-smoke');
    const window=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:680,show:!smoke,autoHideMenuBar:true,icon:path.resolve(__dirname,'../public/brand/multiplexity.ico'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:!smoke}});
    const external=target=>{try{const next=new URL(target);if(['http:','https:'].includes(next.protocol)&&!next.username&&!next.password)void shell.openExternal(target);}catch{ /* Ignore invalid navigation targets. */ }};
    window.webContents.setWindowOpenHandler(({url:target})=>{external(target);return {action:'deny'};});
    window.webContents.on('will-navigate',(event,target)=>{if(new URL(target).origin!==origin){event.preventDefault();external(target);}});
    window.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'&&contents.getURL().startsWith(origin+'/')));
    window.webContents.session.setPermissionCheckHandler((_contents,permission,requestingOrigin)=>permission==='clipboard-sanitized-write'&&requestingOrigin===origin);
    await window.loadURL(origin+'/login');
    if(smoke){
      const deadline=Date.now()+30000;let valid=false;
      while(Date.now()<deadline){valid=await window.webContents.executeJavaScript("!!document.querySelector('#username') && document.body.textContent.includes('Multiplexity')");if(valid)break;await new Promise(resolve=>setTimeout(resolve,100));}
      if(!valid)throw new Error('Development login page unavailable');console.log('DESKTOP_DEV_SMOKE_OK');
      if(process.argv.includes('--composer-smoke')){
        window.showInactive();
        const password=require('node:crypto').randomBytes(20).toString('hex');
        await window.webContents.executeJavaScript(`fetch('/api/auth/desktop-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'composer-smoke',password:${JSON.stringify(password)}})}).then(response=>{if(response.status!==201)throw new Error('Isolated setup failed');})`);
        await window.webContents.executeJavaScript(`(async()=>{const csrf=await fetch('/api/auth/csrf').then(response=>response.json());const response=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'composer-smoke',password:${JSON.stringify(password)},csrfToken:csrf.csrfToken})});if(!response.ok)throw new Error('Login failed');})()`);
        await require('./verify-composer.cjs').verifyComposer(window,origin,process.env.MANAGER_DEV_DATA_PATH);
        await require('./verify-streaming.cjs').verifyStreaming(window,origin,process.env.MANAGER_DEV_DATA_PATH);
      }
      app.quit();
    }
  }).catch(error=>{console.error(error.message);app.exit(1);});
  app.on('window-all-closed',()=>app.quit());
}
