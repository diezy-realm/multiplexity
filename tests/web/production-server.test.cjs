const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const {fork}=require('node:child_process');const {once}=require('node:events');const {randomBytes}=require('node:crypto');
const Database=require('better-sqlite3');const bcrypt=require('bcrypt');
test('production web: shared auth, protected assets and real HTTP Kong CRUD adapter',{timeout:90000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'multiplexity-web-production-'));
 const password=randomBytes(20).toString('hex');const database=path.join(directory,'dashboard.db');
 const db=new Database(database);db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,last_login TEXT)');db.prepare('INSERT INTO users VALUES (?,?,?,NULL)').run('production-user','production-user',await bcrypt.hash(password,4));db.close();
 const entities={services:[],routes:[]};const operations=[];
 const kong=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');const [entity,id]=new URL(req.url,'http://localhost').pathname.slice(1).split('/');if(!entity)return res.end('{"version":"1.5.0"}');if(!entities[entity]){res.writeHead(404);return res.end('{}');}if(req.method==='GET')return res.end(JSON.stringify({data:entities[entity]}));let text='';for await(const chunk of req)text+=chunk;const data=text?JSON.parse(text):{};operations.push(req.method+':'+entity);if(req.method==='POST'){const item={...data,id:'fixture-'+entity};entities[entity].push(item);return res.end(JSON.stringify(item));}if(req.method==='PATCH'){const item=entities[entity].find(item=>item.id===id);Object.assign(item,data);return res.end(JSON.stringify(item));}if(req.method==='DELETE'){entities[entity]=[];res.writeHead(204);return res.end();}res.writeHead(400);res.end('{}');});
 await new Promise(resolve=>kong.listen(0,'127.0.0.1',resolve));
 const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const origin='http://127.0.0.1:'+port;
 const child=fork(path.resolve('dist/server/server.cjs'),[],{cwd:process.cwd(),stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,NODE_ENV:'production',MANAGER_LOCAL_DEV:'0',DESKTOP_MODE:'0',HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:database,MANAGER_DATA_PATH:directory,NEXTAUTH_URL:origin,NEXTAUTH_SECRET:randomBytes(32).toString('hex'),ENCRYPTION_KEY:randomBytes(32).toString('hex')}});
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-2000);});
 const cookies=new Map();
 async function request(endpoint,body,method=body?'POST':'GET',headers={}){const response=await fetch(origin+endpoint,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{origin,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});for(const cookie of response.headers.getSetCookie()){const [name,...value]=cookie.split(';')[0].split('=');cookies.set(name,value.join('='));}return response;}
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Production startup timeout: '+diagnostics)),30000);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Production exited: '+diagnostics));});child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);resolve();}});});
  assert.equal((await request('/api/konga?entity=connection')).status,401);assert.equal((await request('/chat')).status,302);assert.equal((await request('/api/auth/desktop-setup')).status,404);
  const csrf=await(await request('/api/auth/csrf')).json();assert.equal((await request('/api/auth/callback/credentials',{username:'production-user',password,csrfToken:csrf.csrfToken})).status,200);
  assert.equal((await(await request('/api/ai/settings')).json()).localCli,false);
  for(const route of ['/chat','/artifacts','/databases','/konga','/settings','/'])assert.equal((await request(route)).status,200,route);
  for(const route of ['/.env','/package.json','/src/server/auth/session.ts','/../package.json','/unknown'])assert.equal((await request(route)).status,404,route);
  const index=await(await request('/chat')).text();const asset=index.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  const script=await request(asset);assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
  const clientFiles=fs.readdirSync('dist/client/assets');
  for(const name of clientFiles.filter(name=>name.endsWith('.js')))assert.doesNotMatch(fs.readFileSync(path.join('dist/client/assets',name),'utf8'),/password_hash|ENCRYPTION_KEY|DESKTOP_ACCESS_TOKEN|better-sqlite3|node:fs/,name);
  const css=clientFiles.filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(path.join('dist/client/assets',name),'utf8')).join('');
  assert.match(css,/\.h-screen\{/);assert.ok(css.includes('.lg\\:static'),'Desktop layout responsive classes must be emitted');
  assert.equal((await request('/api/snippets',{title:'denied'},'POST',{origin:'https://example.com'})).status,403);
  assert.equal((await request('/api/konga',{adminUrl:'http://127.0.0.1:'+kong.address().port,token:''},'PUT')).status,200);
  assert.equal((await request('/api/konga',{entity:'services',data:{name:'fixture-service',url:'http://127.0.0.1:4000'}})).status,200);
  assert.equal((await request('/api/konga',{entity:'services',id:'fixture-services',data:{name:'fixture-renamed',url:'http://127.0.0.1:4001'}},'PATCH')).status,200);
  assert.equal((await(await request('/api/konga?entity=services')).json()).data[0].name,'fixture-renamed');
  assert.equal((await request('/api/konga',{entity:'routes',data:{name:'fixture-route',serviceId:'fixture-services',paths:['/fixture'],hosts:[],strip_path:true,preserve_host:false}})).status,200);
  assert.equal((await request('/api/konga',{entity:'routes',id:'fixture-routes',data:{name:'fixture-route',serviceId:'fixture-services',paths:['/changed'],hosts:[],strip_path:true,preserve_host:false}},'PATCH')).status,200);
  for(const entity of ['routes','services'])assert.equal((await request('/api/konga',{entity,id:'fixture-'+entity},'DELETE')).status,200);
  assert.equal(operations.length,6);
  console.log('PRODUCTION_WEB_SMOKE_OK',JSON.stringify({legacyUserSchema:true,auth:true,cliDisabled:true,kongCrud:6,privateFilesDenied:true,pages:6}));
 }finally{
  if(child.exitCode===null){const exited=once(child,'exit');if(child.connected)child.send({type:'shutdown'});else child.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(()=>{child.kill();resolve();},10000).unref())]);}
  kong.closeAllConnections();await new Promise(resolve=>kong.close(resolve));fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
