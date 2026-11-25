import type { CompletionObserver } from './stream-events';
export function streamResponse(execute:(observe:CompletionObserver)=>Promise<unknown>,cancel:()=>void) {
  const encoder=new TextEncoder();let closed=false;
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      const send=(event:unknown)=>{if(!closed)controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));};
      const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': ping\n\n'));},15000);
      void execute(send).then(result=>send({type:'done',...result as object})).catch(error=>send({type:'error',error:error instanceof Error?error.message:'Analisis gagal.'})).finally(()=>{clearInterval(heartbeat);if(!closed){closed=true;controller.close();}});
    },cancel(){closed=true;cancel();}
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
