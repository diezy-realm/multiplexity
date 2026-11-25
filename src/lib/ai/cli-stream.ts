import type { CompletionObserver } from './stream-events';

export class CliStreamDecoder {
  private buffer='';private texts=new Map<string,string>();
  constructor(private provider:string,private observe:CompletionObserver){}
  push(text:string){this.buffer+=text;let newline:number;while((newline=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);this.line(line);}}
  finish(){if(this.buffer.trim())this.line(this.buffer);this.buffer='';}
  private line(line:string){
    let event;try{event=JSON.parse(line);}catch{return;}
    if(!event || typeof event!=='object')return;
    if(this.provider==='codex'){
      if(event.type==='turn.started')this.observe({type:'status',stage:'thinking'});
      if(event.item?.type==='agent_message' && typeof event.item.text==='string'){
        const id=String(event.item.id || 'answer');const previous=this.texts.get(id)||'';const next=event.item.text;
        const delta=next.startsWith(previous)?next.slice(previous.length):next;
        this.texts.set(id,next);if(delta)this.observe({type:'delta',text:(previous || this.texts.size===1?'':'\n\n')+delta});
      }else if(event.type==='item.started')this.observe({type:'status',stage:['command_execution','mcp_tool_call','file_change','web_search'].includes(event.item?.type)?'tool':'thinking'});
    }else if(this.provider==='antigravity' && event.event==='step_update'){
      const step=event.step_update;if(step?.step_type==='tool')this.observe({type:'status',stage:'tool'});
      if(step?.step_type==='agent_response' && typeof step.text_delta==='string'){
        const id=String(step.step_index);const previous=this.texts.get(id)||'';
        const delta=step.state==='DONE' && step.text_delta.startsWith(previous)?step.text_delta.slice(previous.length):step.text_delta;
        this.texts.set(id,previous+delta);if(delta)this.observe({type:'delta',text:delta});
      }
    }
  }
}
