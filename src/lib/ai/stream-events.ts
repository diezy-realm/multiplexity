export type ProgressStage = 'sources'|'connecting'|'thinking'|'tool'|'buffered'|'saving';
export type CompletionEvent = {type:'delta';text:string}|{type:'status';stage:ProgressStage};
export type CompletionObserver = (event:CompletionEvent)=>void;

export class SSEDecoder {
  private buffer=''; private data:string[]=[];
  constructor(private receive:(data:string)=>void) {}
  push(text:string) {
    this.buffer+=text;
    if(this.buffer.length>4*1024*1024)throw new Error('Frame stream terlalu besar.');
    let index:number;
    while((index=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,index).replace(/\r$/,'');this.buffer=this.buffer.slice(index+1);if(!line){if(this.data.length)this.receive(this.data.join('\n'));this.data=[];}else if(line.startsWith('data:'))this.data.push(line.slice(5).replace(/^ /,''));}
  }
  finish(){this.push('\n\n');}
}
