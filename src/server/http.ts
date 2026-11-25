import type { IncomingMessage, ServerResponse } from 'node:http';
import { routes } from './routes.generated';
import { requestContext, getServerSession } from './auth/session';
import { authHandler } from './auth/handler';

type Handler=(request:Request,context:{params:Record<string,string>})=>Response|Promise<Response>;
const registry=routes.map(route=>({...route,segments:route.path.split('/'),module:route.module as unknown as Record<string,Handler>}));
export function matchRoute(pathname:string){
  const parts=pathname.replace(/\/$/,'').split('/');
  for(const route of registry){
    if(parts.length!==route.segments.length)continue;
    const params:Record<string,string>={};let matches=true;
    for(let index=0;index<parts.length;index++){
      const segment=route.segments[index];
      if(segment.startsWith('[')){try{const decoded=decodeURIComponent(parts[index]);if(decoded.includes('/')||decoded.includes('\\')||decoded.includes('\0'))return null;params[segment.slice(1,-1)]=decoded;}catch{return null;}}
      else if(segment!==parts[index]){matches=false;break;}
    }
    if(matches)return {module:route.module,params};
  }
  return null;
}
export async function toRequest(req:IncomingMessage,res:ServerResponse,origin:string):Promise<Request>{
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
  const controller=new AbortController();
  req.once('aborted',()=>controller.abort());
  res.once('close',()=>{if(!res.writableFinished)controller.abort();});
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>12_000_000)throw new Error('BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
  return new Request(new URL(req.url||'/',origin),{method:req.method,headers,signal:controller.signal,...(['GET','HEAD'].includes(req.method||'GET')?{}:{body:Buffer.concat(chunks)})});
}
export async function sendResponse(req:IncomingMessage,res:ServerResponse,response:Response){
  res.statusCode=response.status;
  for(const [key,value] of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
  if(req.method==='HEAD'||!response.body){await response.body?.cancel();res.end();return;}
  const reader=response.body.getReader();
  const cancel=()=>{void reader.cancel().catch(()=>{});};res.once('close',cancel);
  try{
    res.flushHeaders();
    while(!res.destroyed){
      const {value,done}=await reader.read();if(done)break;
      if(!res.write(value))await new Promise<void>(resolve=>{
        const resume=()=>{res.off('drain',resume);res.off('close',resume);resolve();};
        res.once('drain',resume);res.once('close',resume);
      });
    }
    if(!res.destroyed)res.end();
  }finally{res.off('close',cancel);await reader.cancel().catch(()=>{});}
}
export async function dispatch(request:Request,client:string):Promise<Response>{
  return requestContext.run(request,async()=>{
    const auth=await authHandler(request,client);if(auth)return auth;
    const pathname=new URL(request.url).pathname;
    if(!pathname.startsWith('/api/auth/')&&!await getServerSession())return Response.json({error:'Unauthorized'},{status:401});
    const route=matchRoute(pathname);if(!route)return Response.json({error:'Not found'},{status:404});
    const method=request.method==='HEAD'?'GET':request.method;
    const handler=route.module[method];
    if(!handler)return Response.json({error:'Method not allowed'},{status:405,headers:{Allow:Object.keys(route.module).filter(key=>/^(GET|POST|PUT|PATCH|DELETE)$/.test(key)).join(', ')}});
    return handler(request,{params:route.params});
  });
}
