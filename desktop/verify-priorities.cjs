const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
async function verifyPriorities(window,origin,directory){
  let calls=0;
  const server=http.createServer(async(request,response)=>{
    for await(const _chunk of request){ /* Only synthetic requests reach this local fixture. */ }
    calls++;
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    response.end('data: '+JSON.stringify({choices:[{delta:{content:'# Priority fixture\n\nSynthetic answer '+calls},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch{fs.writeFileSync(path.join(directory,'priority-failure.png'),(await window.webContents.capturePage()).toPNG());throw new Error('Priority evaluation failed: '+code.slice(0,200));}};
  async function waitFor(code,label){const deadline=Date.now()+20000;while(!await evaluate(code)){if(Date.now()>deadline)throw new Error('Priority UI timeout: '+label);await new Promise(resolve=>setTimeout(resolve,100));}}
  const click=text=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===${JSON.stringify(text)});if(!button)throw new Error('Button missing');button.click();})()`);
  try{
    const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
    await evaluate(`fetch('/api/ai/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'custom',model:'synthetic-priority',endpoint:${JSON.stringify(endpoint)}})}).then(r=>{if(!r.ok)throw new Error('Fixture setup failed');})`);
    await window.loadURL(origin+'/chat');
    await waitFor("!!document.querySelector('[aria-label=\"Pesan chat\"]:not(:disabled)')",'chat');
    await click('Chat baru');
    await waitFor("!document.querySelector('[aria-label=\"Respons AI\"]') && !!document.querySelector('[aria-label=\"Pesan chat\"]:not(:disabled)') && [...document.querySelectorAll('button')].some(node=>node.textContent==='Chat baru'&&!node.disabled)", 'new conversation');
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Pesan chat"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Synthetic priority case');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate("document.querySelector('[aria-label=\"Kirim pesan\"]').click()");
    await waitFor("document.querySelector('[aria-label=\"Respons AI\"]')?.textContent.includes('Synthetic answer 1') && !document.querySelector('[aria-label=\"Hentikan respons\"]')",'completed first answer');
    await waitFor("[...document.querySelectorAll('button')].some(node=>node.textContent==='Regenerate')",'persisted response');
    await click('Regenerate');
    await waitFor("document.querySelector('[aria-label=\"Respons AI\"]')?.textContent.includes('Synthetic answer 2') && !!document.querySelector('[aria-label=\"Versi sebelumnya\"]')",'regenerate versions');
    await evaluate("document.querySelector('[aria-label=\"Versi sebelumnya\"]').click()");
    await waitFor("document.querySelector('[aria-label=\"Respons AI\"]')?.textContent.includes('Synthetic answer 1')",'preserved original answer');
    const link=await evaluate("[...document.querySelectorAll('a')].find(node=>node.textContent.includes('Buka hasil')).getAttribute('href')");
    await window.loadURL(origin+link);
    await waitFor("document.querySelector('[aria-label=\"Isi artifact\"]')?.value.includes('Synthetic answer 1')",'artifact deep link');
    await click('Preview');
    await waitFor("document.querySelector('.markdown-output h1')?.textContent==='Priority fixture'",'Markdown preview');
    await click('Source');
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Isi artifact"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,input.value+${JSON.stringify('\n\nSynthetic edit')});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('Perubahan');
    await waitFor("document.querySelector('main').textContent.includes('Sebelum') && document.querySelector('main').textContent.includes('Synthetic edit')",'change preview');
    await click('Simpan');
    await waitFor("document.querySelector('[role=status]')?.textContent==='Tersimpan'",'save');
    await click('Versi');
    await waitFor("[...document.querySelectorAll('button')].filter(node=>/ · [a-f0-9]{8}$/.test(node.textContent)).length>=2",'version history');
    fs.writeFileSync(path.join(directory,'priorities-artifact.png'),(await window.webContents.capturePage()).toPNG());
    console.log('PRIORITIES_UI_SMOKE_OK',JSON.stringify({newConversation:true,regeneratePreservesOriginal:true,artifactDeepLink:true,markdownPreview:true,changePreview:true,versionHistory:true,fixtureCalls:calls}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
module.exports={verifyPriorities};
