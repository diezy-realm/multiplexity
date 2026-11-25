import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';

export interface Conversation { id:string; title:string; archived:number; updated_at:string }
export function createConversation(user:string, title='Chat baru'): Conversation {
  const id=randomUUID();
  getDb().prepare('INSERT INTO ai_conversations (id,user_id,title,updated_at) VALUES (?,?,?,?)').run(id,user,title,new Date().toISOString());
  return getDb().prepare('SELECT id,title,archived,updated_at FROM ai_conversations WHERE id=?').get(id) as Conversation;
}
export function conversation(user:string, id?:string|null): Conversation | undefined {
  return (id
    ? getDb().prepare('SELECT id,title,archived,updated_at FROM ai_conversations WHERE user_id=? AND id=?').get(user,id)
    : getDb().prepare('SELECT id,title,archived,updated_at FROM ai_conversations WHERE user_id=? AND archived=0 ORDER BY updated_at DESC,rowid DESC LIMIT 1').get(user)) as Conversation | undefined;
}
export function chatHistory(user:string,id:string,limit=100) {
  const rows=getDb().prepare('SELECT id,role,content,created_at,metadata FROM (SELECT * FROM ai_chat_messages WHERE user_id=? AND conversation_id=? ORDER BY id DESC LIMIT ?) ORDER BY id').all(user,id,limit) as {id:number;role:'user'|'assistant';content:string;created_at:string;metadata:string}[];
  return rows.map(({metadata,...row})=>({ ...row,...JSON.parse(metadata),created_at:row.created_at.includes('T')?row.created_at:row.created_at.replace(' ','T')+'Z' }));
}
export function regenerationContext(user:string,id:string,messageId:number) {
  const db=getDb();
  const get=(number:number)=>db.prepare("SELECT id,metadata FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id=? AND role='assistant'").get(user,id,number) as {id:number;metadata:string}|undefined;
  const selected=get(messageId);if(!selected)throw new Error('Jawaban tidak ditemukan.');
  const selectedMeta=JSON.parse(selected.metadata);const root=selectedMeta.variantOf?get(selectedMeta.variantOf):selected;
  if(!root)throw new Error('Jawaban asal tidak ditemukan.');
  const metadata=JSON.parse(root.metadata);
  if(metadata.attachments?.length)throw new Error('Lampirkan ulang file sebagai pesan baru untuk mengulang analisis.');
  const prompt=db.prepare("SELECT id,content FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id<? AND role='user' ORDER BY id DESC LIMIT 1").get(user,id,root.id) as {id:number;content:string}|undefined;
  if(!prompt)throw new Error('Pesan asal tidak ditemukan.');
  const history=modelHistory(user,id,[],prompt.id);
  return {message:prompt.content,history,variantOf:root.id,sources:metadata.contextSources??metadata.sources??[],skill:metadata.skill??'',diagnostic:metadata.diagnostic??'logs',includeResources:!!metadata.includeResources};
}
export function modelHistory(user:string,id:string,selected:number[]=[],before=Number.MAX_SAFE_INTEGER) {
  const rows=getDb().prepare('SELECT id,role,content,metadata FROM (SELECT * FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id<? ORDER BY id DESC LIMIT 100) ORDER BY id').all(user,id,before) as {id:number;role:'user'|'assistant';content:string;metadata:string}[];
  const root=(row:typeof rows[number])=>JSON.parse(row.metadata).variantOf??row.id;
  const answers=new Map<number,typeof rows[number]>();
  for(const row of rows)if(row.role==='assistant')answers.set(root(row),row);
  for(const number of selected){const row=rows.find(item=>item.id===number&&item.role==='assistant');if(!row)throw new Error('Versi konteks tidak tersedia. Muat ulang percakapan.');answers.set(root(row),row);}
  const seen=new Set<number>();
  return rows.flatMap(row=>{
    if(row.role==='user')return [{role:row.role,content:row.content}];
    const key=root(row);if(seen.has(key))return [];seen.add(key);const answer=answers.get(key)!;
    return [{role:answer.role,content:answer.content}];
  }).slice(-20);
}
