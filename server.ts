import './src/server/environment';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Server } from 'socket.io';
import { hasDesktopAccess } from './src/lib/desktop/access';
import { isLocalDevelopment } from './src/lib/runtime';
import { authenticate, authenticateSocket } from './src/server/auth/session';
import { dispatch, sendResponse, toRequest } from './src/server/http';
import { chatOperations } from './src/lib/ai/operations';

const dev=process.env.NODE_ENV!=='production';
const desktop=process.env.DESKTOP_MODE==='1';
const localDevelopment=isLocalDevelopment();
const privateListener=desktop||localDevelopment;
const hostname=privateListener?'127.0.0.1':process.env.HOST||'0.0.0.0';
const port=Number(process.env.PORT||3300);
let origin=process.env.NEXTAUTH_URL||'';
const pages=new Set(['/','/login','/chat','/artifacts','/databases','/konga','/settings']);
function allowed(req:IncomingMessage){
  if(!origin)return false;
  const target=new URL(origin);
  if(req.headers.host!==target.host)return false;
  if(req.headers.origin&&req.headers.origin!==origin)return false;
  if(desktop&&!hasDesktopAccess(req.headers.cookie))return false;
  return true;
}
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
async function staticResponse(pathname:string):Promise<Response|null>{
  let decoded:string;try{decoded=decodeURIComponent(pathname);}catch{return null;}
  if(decoded.includes('\\')||decoded.includes('\0'))return null;
  const root=path.resolve('dist/client');const file=path.resolve(root,'.'+decoded);
  if(!file.startsWith(root+path.sep))return null;
  try{if(!(await stat(file)).isFile())return null;return new Response(new Uint8Array(await readFile(file)),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'}});}catch{return null;}
}
async function main(){
  if(!process.env.NEXTAUTH_SECRET||!process.env.ENCRYPTION_KEY)throw new Error('NEXTAUTH_SECRET and ENCRYPTION_KEY are required');
  if(!privateListener){const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.origin!==origin)throw new Error('NEXTAUTH_URL must be the public origin');}
  const httpServer=createServer();
  const io=new Server(httpServer,{path:'/api/socketio',addTrailingSlash:false,serveClient:false,transports:['websocket','polling'],pingTimeout:60000,pingInterval:25000,destroyUpgrade:false,allowRequest:(req,callback)=>callback(null,allowed(req)),cors:{origin:(value,callback)=>callback(null,!value||value===origin),credentials:true}});
  (globalThis as typeof globalThis & {managerSocketServer?:import('./src/lib/socket/socket-server').IOServer}).managerSocketServer=io;
  io.use(authenticateSocket);
  io.on('connection',async socket=>{
    const {registerTerminalHandlers}=await import('./src/lib/socket/terminal-handler');
    const {registerLogHandlers}=await import('./src/lib/socket/log-handler');
    registerTerminalHandlers(socket as import('./src/lib/socket/socket-server').AuthenticatedSocket);
    registerLogHandlers(socket as import('./src/lib/socket/socket-server').AuthenticatedSocket);
  });
  const vite=dev?await (await import('vite')).createServer({configFile:path.resolve('vite.config.mts'),server:{middlewareMode:true,ws:{server:httpServer,path:'/__vite_hmr'}},appType:'custom'}):undefined;
  httpServer.on('request',(req,res)=>{
    if(req.url?.startsWith('/api/socketio'))return;
    void (async()=>{
      if(!allowed(req)){res.writeHead(403);res.end('Forbidden');return;}
      if(privateListener){delete req.headers['x-forwarded-host'];delete req.headers['x-forwarded-proto'];delete req.headers['x-forwarded-port'];}
      const pathname=new URL(req.url||'/',origin).pathname;
      if(pathname.startsWith('/api/')){
        if(!['GET','HEAD'].includes(req.method||'GET')&&req.headers.origin!==origin){await sendResponse(req,res,Response.json({error:'Forbidden'},{status:403}));return;}
        const request=await toRequest(req,res,origin);
        const response=await dispatch(request,req.socket.remoteAddress||'unknown');
        response.headers.set('Cache-Control','no-store');
        await sendResponse(req,res,response);return;
      }
      if(pages.has(pathname)){
        if(!['GET','HEAD'].includes(req.method||'GET')){await sendResponse(req,res,new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}}));return;}
        const session=await authenticate(req.headers.cookie);
        if(!session&&pathname!=='/login'){await sendResponse(req,res,new Response(null,{status:302,headers:{Location:'/login?callbackUrl='+encodeURIComponent(pathname+new URL(req.url||'/',origin).search)}}));return;}
        if(session&&pathname==='/login'){await sendResponse(req,res,new Response(null,{status:302,headers:{Location:'/'}}));return;}
        const html=dev?await vite!.transformIndexHtml(req.url||'/',await readFile('index.html','utf8')):await readFile('dist/client/index.html','utf8');
        await sendResponse(req,res,new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}));return;
      }
      if(vite){vite.middlewares(req,res,()=>{if(!res.writableEnded){res.writeHead(404);res.end('Not found');}});return;}
      await sendResponse(req,res,await staticResponse(pathname)||new Response('Not found',{status:404}));
    })().catch(error=>{
      if(!res.headersSent){res.writeHead(error instanceof Error&&error.message==='BODY_TOO_LARGE'?413:500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request failed'}));}
      else res.destroy();
    });
  });
  let stopping=false;
  const shutdown=async()=>{
    if(stopping)return;stopping=true;
    const timer=setTimeout(()=>process.exit(1),8000);timer.unref();
    for(const operation of chatOperations.values())operation.abort();
    io.disconnectSockets(true);io.close();httpServer.closeAllConnections();
    await vite?.close();
    const {resetDatabaseManager}=await import('./src/lib/db/database-manager');
    const {resetTunnelManager}=await import('./src/lib/db/tunnel-manager');
    const {resetSSHManager}=await import('./src/lib/ssh/ssh-manager');
    await resetDatabaseManager();await resetTunnelManager();await resetSSHManager();
    const {closeDb}=await import('./src/lib/db');closeDb();process.exit(0);
  };
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
  if(process.send){process.on('message',message=>{if((message as {type?:string})?.type==='shutdown')void shutdown();});process.once('disconnect',()=>void shutdown());}
  httpServer.once('error',()=>{console.error('Failed to start shared Node server');process.exit(1);});
  httpServer.listen(port,hostname,()=>{
    const address=httpServer.address();const actualPort=typeof address==='object'&&address?address.port:port;
    if(privateListener){origin=`http://${localDevelopment||process.env.DESKTOP_WEB_HOST==='localhost'?'localhost':'127.0.0.1'}:${actualPort}`;process.env.NEXTAUTH_URL=origin;process.env.NEXTAUTH_URL_INTERNAL=origin;}
    process.send?.({type:'ready',origin});console.log(`> Multiplexity ${dev?'development':'production'}: ${origin}`);
  });
}
void main().catch(()=>{console.error('Failed to prepare shared Node server');process.exit(1);});
