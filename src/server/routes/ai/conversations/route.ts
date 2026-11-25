import { currentUserId } from '@/lib/user';
import { getDb } from '@/lib/db';
import { conversation, createConversation } from '@/lib/ai/conversations';
import { chatOperations } from '@/lib/ai/operations';
export async function GET() {
  const user=await currentUserId();if(!user)return Response.json({error:'Unauthorized'},{status:401});
  return Response.json({conversations:getDb().prepare('SELECT id,title,archived,updated_at FROM ai_conversations WHERE user_id=? ORDER BY updated_at DESC,rowid DESC').all(user)},{headers:{'Cache-Control':'no-store'}});
}
export async function POST() {
  const user=await currentUserId();if(!user)return Response.json({error:'Unauthorized'},{status:401});
  return Response.json({conversation:createConversation(user)},{status:201});
}
export async function PATCH(request:Request) {
  const user=await currentUserId();if(!user)return Response.json({error:'Unauthorized'},{status:401});
  if(chatOperations.has(user))return Response.json({error:'Hentikan respons terlebih dahulu.'},{status:409});
  let body;try{body=await request.json();}catch{return Response.json({error:'Invalid JSON'},{status:400});}
  if(!body || typeof body.id!=='string' || (body.title!==undefined && (typeof body.title!=='string'||!body.title.trim()||body.title.length>120)) || (body.archived!==undefined && typeof body.archived!=='boolean'))return Response.json({error:'Percakapan tidak valid.'},{status:400});
  const item=conversation(user,body.id);if(!item)return Response.json({error:'Percakapan tidak ditemukan.'},{status:404});
  getDb().prepare("UPDATE ai_conversations SET title=?,archived=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?").run(body.title?.trim()??item.title,body.archived===undefined?item.archived:Number(body.archived),item.id,user);
  return Response.json({conversation:conversation(user,item.id)});
}
