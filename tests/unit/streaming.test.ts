import { expect,it } from 'vitest';
import http from 'http';
import { SSEDecoder } from '@/lib/ai/stream-events';
import { ProviderStreamAccumulator,providerStreamRequest } from '@/lib/ai/provider-stream';
import { CliStreamDecoder } from '@/lib/ai/cli-stream';
import { readChatResponse } from '@/lib/ai/chat-stream-client';
import type { CompletionEvent } from '@/lib/ai/stream-events';

it('decodes fragmented SSE frames, CRLF, comments and multiline data',()=>{
  const frames:string[]=[];const parser=new SSEDecoder(text=>frames.push(text));
  for(const chunk of [': ping\r','\ndata: first\r\n','data: second\r\n\r','\ndata: final'])parser.push(chunk);
  parser.finish();expect(frames).toEqual(['first\nsecond','final']);
});
it('streams only visible Responses text and retains authoritative tool call results',()=>{
  const events:CompletionEvent[]=[];const parser=new ProviderStreamAccumulator('responses',event=>events.push(event));
  parser.event(JSON.stringify({type:'response.reasoning_text.delta',delta:'not-for-user'}));
  parser.event(JSON.stringify({type:'response.output_text.delta',delta:'Visible'}));
  const response={output:[{type:'function_call',name:'read_artifact',arguments:'{}',call_id:'call'}]};
  parser.event(JSON.stringify({type:'response.completed',response}));
  expect(events).toEqual([{type:'delta',text:'Visible'}]);expect(parser.finish()).toEqual(response);
});
it('reconstructs Claude tool JSON and text across content block deltas',()=>{
  const events:CompletionEvent[]=[];const parser=new ProviderStreamAccumulator('messages',event=>events.push(event));
  for(const event of [{type:'message_start',message:{id:'x'}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool',name:'read_artifact',input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"name":'}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'"rules.md"}'}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'text',text:''}},{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Evidence'}},{type:'message_stop'}])parser.event(JSON.stringify(event));
  expect(parser.finish()).toMatchObject({content:[{input:{name:'rules.md'}},{text:'Evidence'}]});
  expect(events).toContainEqual({type:'delta',text:'Evidence'});
});
it('rejects truncated or failed provider streams',()=>{
  const parser=new ProviderStreamAccumulator('chat',()=>{});
  parser.event('{"choices":[{"delta":{"content":"partial"}}]}');expect(()=>parser.finish()).toThrow('terputus');
  expect(()=>parser.event('{"error":{"message":"sensitive-provider-details"}}')).toThrow('menghentikan');
});
it('handles Codex snapshots without duplicates and ignores command output',()=>{
  const events:CompletionEvent[]=[];const parser=new CliStreamDecoder('codex',event=>events.push(event));
  for(const text of ['Hel','Hello','Hello'])parser.push(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text}})+'\n');
  parser.push(JSON.stringify({type:'item.completed',item:{type:'command_execution',output:'secret-output'}})+'\n');
  expect(events).toEqual([{type:'delta',text:'Hel'},{type:'delta',text:'lo'}]);
});
it('reads documented agy text deltas without exposing tool_info',()=>{
  const events:CompletionEvent[]=[];const parser=new CliStreamDecoder('antigravity',event=>events.push(event));
  parser.push(JSON.stringify({event:'step_update',step_update:{step_type:'tool',tool_info:{output:'private'}}})+'\n');
  for(const [state,text_delta] of [['ACTIVE','Hel'],['DONE','Hello']])parser.push(JSON.stringify({event:'step_update',step_update:{step_index:1,step_type:'agent_response',state,text_delta}})+'\n');
  expect(events).toEqual([{type:'status',stage:'tool'},{type:'delta',text:'Hel'},{type:'delta',text:'lo'}]);
});
it('receives a provider delta over HTTP before the provider closes the response',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let sawDelta!:()=>void;const delta=new Promise<void>(resolve=>{sawDelta=resolve;});
  const server=http.createServer(async(_request,response)=>{response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: {"choices":[{"delta":{"content":"Halo 🌟"}}]}\n\n');await gate;response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address() as {port:number};let settled=false;
    const result=providerStreamRequest(`http://127.0.0.1:${address.port}/chat`,{},{},undefined,'chat',event=>{if(event.type==='delta'){expect(event.text).toBe('Halo 🌟');sawDelta();}}).then(value=>{settled=true;return value;});
    await delta;expect(settled).toBe(false);release();expect(await result).toMatchObject({choices:[{message:{content:'Halo 🌟'}}]});
  }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('client reads split UTF-8 and requires a persisted done event',async()=>{
  const wire=new TextEncoder().encode('data: {"type":"delta","text":"🌟"}\n\ndata: {"type":"done","message":"🌟"}\n\n');let index=0;
  const response=new Response(new ReadableStream({pull(controller){if(index>=wire.length)controller.close();else controller.enqueue(wire.slice(index,index+=1));}}),{headers:{'Content-Type':'text/event-stream'}});
  const events:CompletionEvent[]=[];expect(await readChatResponse(response,event=>events.push(event))).toMatchObject({message:'🌟'});expect(events).toEqual([{type:'delta',text:'🌟'}]);
  await expect(readChatResponse(new Response('data: {"type":"delta","text":"partial"}\n\n',{headers:{'Content-Type':'text/event-stream'}}),()=>{})).rejects.toThrow('terputus');
});
