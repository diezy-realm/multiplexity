const {test}=require('node:test');const assert=require('node:assert/strict');
const {fork}=require('node:child_process');const {once}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');const os=require('node:os');const path=require('node:path');
const {randomBytes}=require('node:crypto');const http=require('node:http');const {io}=require('socket.io-client');const WebSocket=require('ws');
test('local web: setup, session, shared features, streaming, Socket.IO and HMR',{timeout:300000},async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'multiplexity-web-server-'));
 const child=fork(path.resolve('scripts/local-web.cjs'),[],{stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,PORT:'0',MANAGER_DEV_DATA_PATH:directory}});
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-3000);});
 const model=http.createServer(async(request,response)=>{for await(const _chunk of request){}response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: '+JSON.stringify({choices:[{delta:{content:'# Web fixture\n\nPartial '}}]})+'\n\n');setTimeout(()=>response.end('data: '+JSON.stringify({choices:[{delta:{content:'answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'),100);});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Web startup timeout: '+diagnostics)),90000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Web exited: '+diagnostics));});child.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);resolve(message.origin);}});});
  assert.match(origin,/^http:\/\/localhost:\d+$/);
  const cookies=new Map();
  async function request(endpoint,options={}){const response=await fetch(origin+endpoint,{...options,signal:AbortSignal.timeout(90000),redirect:'manual',headers:{host:new URL(origin).host,origin,cookie:[...cookies].map(([name,value])=>name+'='+value).join('; '),...options.headers}});for(const cookie of response.headers.getSetCookie()){const [name,...parts]=cookie.split(';')[0].split('=');cookies.set(name,parts.join('='));}return response;}
  const post=(endpoint,body)=>request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request('/login',{headers:{origin:'https://example.com'}})).status,403);
  const forgedHost=await new Promise((resolve,reject)=>{const probe=http.get(origin+'/login',{headers:{Host:'example.com'}},response=>{response.resume();resolve(response.statusCode);});probe.on('error',reject);probe.setTimeout(10000,()=>probe.destroy(new Error('Host probe timeout')));});
  assert.equal(forgedHost,403);
  assert.equal((await request('/login')).status,200);
  assert.equal((await(await request('/api/auth/desktop-setup')).json()).setupRequired,true);
  const credentials={username:'web-test',password:randomBytes(18).toString('hex')};
  assert.equal((await post('/api/auth/desktop-setup',credentials)).status,201);
  const csrf=await(await request('/api/auth/csrf')).json();
  assert.equal((await request('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...credentials,csrfToken:csrf.csrfToken,json:'true',callbackUrl:origin}).toString()})).status,200);
  assert.equal((await(await request('/api/auth/session')).json()).user.name,credentials.username);
  const settings=await(await request('/api/ai/settings')).json();assert.equal(settings.desktop,false);assert.equal(settings.localCli,true);assert.equal(settings.runtime,'local-development');
  assert.equal((await post('/api/ai/detect',{provider:'codex'})).status,200);
  assert.equal((await post('/api/ai/settings',{provider:'custom',model:'synthetic-web',endpoint:'http://127.0.0.1:'+model.address().port+'/v1'})).status,200);
  const conversation=await(await post('/api/ai/conversations',{})).json();assert.ok(conversation.conversation.id);
  const response=await request('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({conversationId:conversation.conversation.id,provider:'custom',model:'synthetic-web',effort:'default',permission:'read-only',message:'Synthetic web question',sources:[],attachments:[]})});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);const wire=await response.text();assert.match(wire,/"type":"delta"/);assert.match(wire,/"type":"done"/);
  const history=await(await request('/api/ai/chat?conversation='+conversation.conversation.id)).json();assert.equal(history.messages.length,2);assert.match(history.messages[1].content,/Partial answer/);
  const artifact=await(await request('/api/artifacts?name='+encodeURIComponent(history.messages[1].artifact))).json();assert.match(artifact.content,/Web fixture/);
  assert.equal((await post('/api/artifacts',{name:'artifacts/web.md',content:'# Local web'})).status,200);
  const versions=await(await request('/api/artifacts?name=artifacts%2Fweb.md&versions=1')).json();assert.equal(versions.versions.length,1);
  assert.equal((await post('/api/snippets',{title:'Fixture path',kind:'path',content:'/synthetic/path'})).status,200);
  for(const route of ['/chat','/artifacts','/databases','/konga','/settings','/']){const page=await request(route);assert.equal(page.status,200,route);assert.match(await page.text(),/Multiplexity/);}
  const cookie=[...cookies].map(([name,value])=>name+'='+value).join('; ');
  const socket=io(origin,{path:'/api/socketio',transports:['websocket'],reconnection:false,timeout:15000,extraHeaders:{Cookie:cookie,Origin:origin}});
  try{await Promise.race([once(socket,'connect'),once(socket,'connect_error').then(()=>{throw new Error('Authenticated web socket rejected');})]);}finally{socket.disconnect();}
  const clientSource=await(await request('/@vite/client')).text();const wsToken=clientSource.match(/const wsToken = "([^"]+)"/)?.[1];assert.ok(wsToken,'Vite client WebSocket token');
  const hmr=new WebSocket(origin.replace('http:','ws:')+'/__vite_hmr?token='+encodeURIComponent(wsToken),'vite-hmr',{headers:{Cookie:cookie,Origin:origin}});
  try{await Promise.race([once(hmr,'open'),once(hmr,'error').then(()=>{throw new Error('HMR upgrade failed');})]);}finally{hmr.terminate();}
  console.log('LOCAL_WEB_SMOKE_OK',JSON.stringify({firstSetup:true,login:true,cliDiscovery:true,chatStreaming:true,conversations:true,artifacts:true,snippets:true,pages:6,socketIo:true,hmr:true}));
 }finally{
  if(child.connected){const exited=once(child,'exit');child.send({type:'shutdown'});await Promise.race([exited,new Promise(resolve=>setTimeout(()=>{child.kill();resolve();},12000).unref())]);}
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));rmSync(directory,{recursive:true,force:true});
 }
});
