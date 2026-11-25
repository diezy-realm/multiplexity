import http from 'http';
import https from 'https';
import { StringDecoder } from 'string_decoder';
import { SSEDecoder, type CompletionObserver } from './stream-events';

type Protocol = 'responses'|'messages'|'chat';
type Block = {type:string;text?:string;input?:unknown;[key:string]:unknown};
export class ProviderStreamAccumulator {
  private result:Record<string,unknown>={}; private text=''; private ended=false;
  private blocks:Block[]=[]; private arguments=new Map<number,string>();
  constructor(private protocol:Protocol,private observe:CompletionObserver){}
  event(raw:string){
    if(raw==='[DONE]'){this.ended=true;return;}
    const event=JSON.parse(raw);
    if(!event || typeof event!=='object')throw new Error('Format event provider tidak valid.');
    if(event.error || ['error','response.failed','response.incomplete'].includes(event.type))throw new Error('Provider menghentikan stream. Periksa model, kuota, dan koneksi.');
    if(this.protocol==='responses'){
      if(event.type==='response.output_text.delta' && typeof event.delta==='string')this.observe({type:'delta',text:event.delta});
      if(event.type==='response.output_item.added' && event.item?.type==='function_call')this.observe({type:'status',stage:'tool'});
      if(event.type==='response.completed'){this.result=event.response;this.ended=true;}
    }else if(this.protocol==='messages'){
      if(event.type==='message_start')this.result=event.message;
      if(event.type==='content_block_start'){this.blocks[event.index]={...event.content_block};if(event.content_block.type==='tool_use')this.observe({type:'status',stage:'tool'});}
      if(event.type==='content_block_delta'){
        const block=this.blocks[event.index];if(!block)throw new Error('Urutan stream tidak valid.');
        if(event.delta?.type==='text_delta'){block.text=(block.text || '')+event.delta.text;this.observe({type:'delta',text:event.delta.text});}
        if(event.delta?.type==='input_json_delta')this.arguments.set(event.index,(this.arguments.get(event.index)||'')+event.delta.partial_json);
      }
      if(event.type==='content_block_stop' && this.arguments.has(event.index))this.blocks[event.index].input=JSON.parse(this.arguments.get(event.index)!);
      if(event.type==='message_delta')Object.assign(this.result,event.delta);
      if(event.type==='message_stop'){this.result.content=this.blocks;this.ended=true;}
    }else{
      const choice=event.choices?.[0];const delta=choice?.delta?.content;
      if(typeof delta==='string'){this.text+=delta;this.observe({type:'delta',text:delta});}
      if(choice?.finish_reason){if(choice.finish_reason==='length')throw new Error('Respons terpotong karena batas token.');this.ended=true;}
      this.result={choices:[{message:{content:this.text}}]};
    }
  }
  finish(){if(!this.ended)throw new Error('Stream provider terputus sebelum selesai.');return this.result;}
}

export function providerStreamRequest(url:string,headers:Record<string,string>,body:Record<string,unknown>,signal:AbortSignal | undefined,protocol:Protocol,observe:CompletionObserver):Promise<Record<string,unknown>>{
  return new Promise((resolve,reject)=>{
    const target=new URL(url);
    if(target.protocol!=='https:' && !(target.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname))){reject(new Error('Endpoint harus HTTPS atau HTTP localhost.'));return;}
    const encoded=JSON.stringify({...body,stream:true});
    const request=(target.protocol==='http:'?http:https).request(target,{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'text/event-stream','Content-Length':Buffer.byteLength(encoded)},rejectUnauthorized:true,signal},response=>{
      if(!response.statusCode || response.statusCode<200 || response.statusCode>=300){response.resume();reject(new Error(`Provider HTTP ${response.statusCode || 502}. Periksa model, kredensial, dan dukungan streaming.`));return;}
      const accumulator=new ProviderStreamAccumulator(protocol,observe);const decoder=new StringDecoder('utf8');const parser=new SSEDecoder(data=>accumulator.event(data));
      const isJson=String(response.headers['content-type']).includes('application/json');let json='';let bytes=0;
      response.on('data',(chunk:Buffer)=>{try{bytes+=chunk.length;if(bytes>4*1024*1024)throw new Error('Respons provider terlalu besar.');const text=decoder.write(chunk);if(isJson)json+=text;else parser.push(text);}catch(error){request.destroy();reject(error);}});
      response.on('error',()=>reject(new Error('Stream provider terputus.')));
      response.on('end',()=>{try{if(isJson){observe({type:'status',stage:'buffered'});resolve(JSON.parse(json+decoder.end()));}else{parser.push(decoder.end());parser.finish();resolve(accumulator.finish());}}catch(error){reject(error);}});
    });
    request.on('error',()=>reject(new Error(signal?.aborted?'Permintaan dibatalkan.':'Koneksi streaming provider gagal.')));
    request.setTimeout(120000,()=>request.destroy(new Error('Provider timeout.')));
    request.end(encoded);
  });
}
