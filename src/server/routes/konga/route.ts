import { currentUserId } from '@/lib/user';
import { validAdminUrl, getKongConnection, saveKongConnection, connectionToken, kongRequest, entityData } from '@/lib/kong';

async function account() { return currentUserId(); }
function failure(error: unknown) {
  const message = error instanceof Error && !/fetch failed|abort|timeout|connect|ECONN/i.test(error.message) ? error.message : 'Admin API tidak dapat dihubungi. Periksa URL, jaringan, dan token.';
  return Response.json({error:message},{status:400});
}
export async function GET(request: Request) {
  const user = await account(); if (!user) return Response.json({error:'Unauthorized'},{status:401});
  const connection = getKongConnection(user);
  const query = new URL(request.url).searchParams;
  if (query.get('entity') === 'connection') return Response.json({adminUrl:connection?.admin_url || 'http://172.18.139.190:4567',connected:!!connection,hasToken:!!connection?.token_encrypted});
  if (!connection) return Response.json({error:'Hubungkan Kong Admin API terlebih dahulu.'},{status:409});
  const entity = query.get('entity'); if (!['services','routes'].includes(entity || '')) return Response.json({error:'Entity tidak valid.'},{status:400});
  try {
    const offset = query.get('offset'); if (offset && (offset.length > 512 || /[\r\n]/.test(offset))) throw new Error('Offset tidak valid.');
    const result = await kongRequest(connection.admin_url,connectionToken(connection),`/${entity}?size=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`);
    return Response.json({data:result.data,offset:result.offset || null},{headers:{'Cache-Control':'no-store'}});
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const user = await account(); if (!user) return Response.json({error:'Unauthorized'},{status:401});
  try {
    const body = await request.json(); const url = validAdminUrl(body.adminUrl);
    const previous = getKongConnection(user);
    if (body.token !== undefined && (typeof body.token !== 'string' || body.token.length > 4000 || /[\r\n]/.test(body.token))) throw new Error('Token tidak valid.');
    const token = body.clearToken ? '' : body.token || (previous && previous.admin_url === url ? connectionToken(previous) : '');
    const result = await kongRequest(url,token,'/');
    if (typeof result.version !== 'string') throw new Error('Endpoint bukan Kong Admin API.');
    saveKongConnection(user,url,token);
    return Response.json({success:true,version:result.version});
  } catch (error) { return failure(error); }
}
async function mutate(request: Request, method: string) {
  const user = await account(); if (!user) return Response.json({error:'Unauthorized'},{status:401});
  try {
    const text = await request.text(); if (text.length > 16000) throw new Error('Data terlalu besar.');
    const body = JSON.parse(text); if (!['services','routes'].includes(body.entity)) throw new Error('Entity tidak valid.');
    if (method !== 'POST' && (typeof body.id !== 'string' || !/^[a-zA-Z0-9._~-]{1,128}$/.test(body.id))) throw new Error('ID tidak valid.');
    const connection = getKongConnection(user); if (!connection) throw new Error('Hubungkan Kong Admin API terlebih dahulu.');
    const data = method === 'DELETE' ? undefined : entityData(body.entity,body.data);
    const result = await kongRequest(connection.admin_url,connectionToken(connection),`/${body.entity}${method === 'POST' ? '' : `/${encodeURIComponent(body.id)}`}`,method,data);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => mutate(request,'POST');
export const PATCH = (request: Request) => mutate(request,'PATCH');
export const DELETE = (request: Request) => mutate(request,'DELETE');
