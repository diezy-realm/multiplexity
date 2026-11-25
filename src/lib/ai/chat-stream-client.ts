import { SSEDecoder, type CompletionEvent } from './stream-events';
export interface ChatResult {message:string;artifact?:string;conversationId?:string;variantOf?:number;steps?:{stage:import("./stream-events").ProgressStage;at:string}[];sources?:{label:string;timestamp:string;excerpt?:string;truncated?:boolean}[]}
export async function readChatResponse(response:Response,receive:(event:CompletionEvent)=>void):Promise<ChatResult>{
  if(!response.ok){const data=await response.json();throw new Error(data.error || 'Chat gagal.');}
  if(!response.headers?.get('content-type')?.includes('text/event-stream')){
    const data=await response.json();
    const message=data.message??data.analysis;
    if(typeof message!=='string')throw new Error('Provider tidak mengembalikan teks.');
    return {...data,message};
  }
  const reader=response.body?.getReader();if(!reader)throw new Error('Stream tidak tersedia.');
  let result:ChatResult | undefined;const decoder=new TextDecoder();
  const parser=new SSEDecoder(data=>{const event=JSON.parse(data);if(event.type==='error')throw new Error(event.error || 'Chat gagal.');if(event.type==='done')result=event;else if(event.type==='delta' && typeof event.text==='string' || event.type==='status' && typeof event.stage==='string')receive(event);});
  try{while(true){const chunk=await reader.read();if(chunk.done)break;parser.push(decoder.decode(chunk.value,{stream:true}));}parser.push(decoder.decode());parser.finish();if(!result)throw new Error('Stream terputus sebelum hasil tersimpan.');return result;}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
