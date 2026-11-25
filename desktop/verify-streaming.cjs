const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
async function verifyStreaming(window,origin,directory){
  let release;let requests=0;let cancelled=false;
  const server=http.createServer(async(request,response)=>{
    for await(const _chunk of request){ /* Drain the synthetic request without recording it. */ }
    requests++;response.writeHead(200,{'Content-Type':'text/event-stream'});
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'# Streaming fixture\n\nFirst line'}}]})+'\n\n');
    if(requests===1){await new Promise(resolve=>{release=resolve;});response.end('data: '+JSON.stringify({choices:[{delta:{content:'\n\n**Final line**'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else response.on('close',()=>{cancelled=true;});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const evaluate=code=>window.webContents.executeJavaScript(code,true);
  async function waitFor(code,label){const deadline=Date.now()+20000;while(!await evaluate(code)){if(Date.now()>deadline)throw new Error(`Streaming UI timeout: ${label}`);await new Promise(resolve=>setTimeout(resolve,100));}}
  const draft=text=>evaluate(`(() => {const input=document.querySelector('[aria-label="Pesan chat"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  try{
    const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
    await evaluate(`fetch('/api/ai/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'custom',model:'synthetic-stream-model',endpoint:${JSON.stringify(endpoint)}})}).then(response=>{if(!response.ok)throw new Error('Cannot save synthetic provider');return true;})`);
    await window.loadURL(origin+'/chat');
    await waitFor("!!document.querySelector('[aria-label=\"Pesan chat\"]:not(:disabled)')",'composer');
    await draft('Synthetic streaming check');
    await evaluate("document.querySelector('[aria-label=\"Kirim pesan\"]').click()");
    await waitFor("document.querySelector('[aria-label=\"Respons AI berjalan\"]')?.textContent.includes('First line')",'partial answer before provider completion');
    if(await evaluate("document.querySelector('[aria-label=\"Respons AI berjalan\"]').textContent.includes('Final line')"))throw new Error('Answer was buffered');
    fs.writeFileSync(path.join(directory,'streaming-progress.png'),(await window.webContents.capturePage()).toPNG());
    release();
    await waitFor("!document.querySelector('[aria-label=\"Hentikan respons\"]') && [...document.querySelectorAll('[aria-label=\"Respons AI\"]')].some(node=>node.textContent.includes('Final line'))",'completed answer');
    const aligned=await evaluate(`(() => {const footer=[...document.querySelectorAll('[aria-label="Respons AI"]')].find(node=>node.textContent.includes('Final line')).querySelector('.response-actions');const buttons=[...footer.querySelectorAll('button')];return buttons.length===2 && Math.abs(buttons[0].getBoundingClientRect().y-buttons[1].getBoundingClientRect().y)<1 && buttons.every(button=>button.getBoundingClientRect().height===32);})()`);
    if(!aligned)throw new Error('Response footer icons are not aligned');
    window.webContents.debugger.attach('1.3');
    try{
      const hoverColors=[];
      for(const label of ['Copy response','Unduh Markdown']){
        const position=await evaluate(`(() => {const rect=document.querySelector('[aria-label="${label}"]').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...position});
        await new Promise(resolve=>setTimeout(resolve,200));
        hoverColors.push(await evaluate(`getComputedStyle(document.querySelector('[aria-label="${label}"]')).color`));
      }
      if(hoverColors[0]!==hoverColors[1])throw new Error('Copy and download hover colors differ');
    }finally{window.webContents.debugger.detach();}
    fs.writeFileSync(path.join(directory,'streaming-complete.png'),(await window.webContents.capturePage()).toPNG());
    await draft('Synthetic cancel check');await evaluate("document.querySelector('[aria-label=\"Kirim pesan\"]').click()");
    await waitFor("!!document.querySelector('[aria-label=\"Respons AI berjalan\"]')",'second response');
    await evaluate("document.querySelector('[aria-label=\"Hentikan respons\"]').click()");
    await waitFor("!document.querySelector('[aria-label=\"Hentikan respons\"]')",'stop');
    const until=Date.now()+5000;while(!cancelled && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
    if(!cancelled)throw new Error('Provider connection was not cancelled');
    const persisted=await evaluate("fetch('/api/ai/chat').then(r=>r.json()).then(data=>data.messages.filter(message=>message.content==='Synthetic cancel check').length)");
    if(persisted)throw new Error('Cancelled response persisted');
    for(const [route,title] of [['/','Virtual Machines'],['/databases','Databases'],['/konga','Konga'],['/artifacts','Artifact'],['/settings','Setting'],['/chat','Chat']]){
      await window.loadURL(origin+route);await waitFor(`document.querySelector('[data-testid="page-header"] h1')?.textContent===${JSON.stringify(title)}`,'shared topbar '+route);
      if(await evaluate("[...document.querySelectorAll('main h1')].some(node=>!node.closest('.markdown-output'))"))throw new Error('Duplicate page header');
      if(route==='/databases'){
        await waitFor("!!document.querySelector('[role=tab][aria-selected=true]')",'database tabs');
        fs.writeFileSync(path.join(directory,'database-topbar.png'),(await window.webContents.capturePage()).toPNG());
      }
    }
    if(!await evaluate("!!document.querySelector('[aria-label=\"Sidebar kanan\"] [aria-label=\"Logout\"]') && !document.querySelector('[aria-label=\"Toggle right window\"]')"))throw new Error('Right rail controls are incorrect');
    await waitFor("[...document.images].some(image=>image.alt==='Multiplexity' && image.naturalWidth>0)",'generated brand asset');
    console.log('STREAMING_UI_SMOKE_OK',JSON.stringify({realHttpProvider:true,partialBeforeCompletion:true,cancelled:true,alignedFooter:true,matchingHover:true,sharedHeaders:6,brand:true}));
  }finally{release?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
module.exports={verifyStreaming};
