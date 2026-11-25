const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function verifyKonga(window, origin, directory) {
  const entities = {services:[],routes:[]}; const operations = [];
  const server = http.createServer(async (request,response) => {
    response.setHeader('Content-Type','application/json');
    const url = new URL(request.url,'http://localhost'); const [entity,id] = url.pathname.slice(1).split('/');
    if (!entity) return response.end(JSON.stringify({version:'1.5.0'}));
    if (!entities[entity]) {response.statusCode=404;return response.end('{}');}
    if (request.method === 'GET') return response.end(JSON.stringify({data:entities[entity],offset:null}));
    let text=''; for await (const chunk of request) text+=chunk;
    const body = text ? JSON.parse(text) : {};
    operations.push(`${request.method}:${entity}`);
    if (request.method === 'POST') {
      const item={...body,id:`synthetic-${entity}`};
      if (body.url) {const target=new URL(body.url);Object.assign(item,{protocol:target.protocol.slice(0,-1),host:target.hostname,port:Number(target.port),path:target.pathname});}
      entities[entity].push(item); return response.end(JSON.stringify(item));
    }
    if (request.method === 'PATCH') { const item=entities[entity].find(item=>item.id===id); Object.assign(item,body); return response.end(JSON.stringify(item)); }
    if (request.method === 'DELETE') { entities[entity]=entities[entity].filter(item=>item.id!==id);response.statusCode=204;return response.end(); }
    response.statusCode=400;response.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch{fs.writeFileSync(path.join(directory,'konga-failure.png'),(await window.webContents.capturePage()).toPNG());throw new Error(`Gateway evaluation failed: ${code.slice(0,160)}`);}};
  async function waitFor(code,label) {const deadline=Date.now()+20000;while(!await evaluate(code)){if(Date.now()>deadline)throw new Error(`Gateway smoke timeout: ${label}`);await new Promise(resolve=>setTimeout(resolve,100));}}
  const input=(label,value)=>evaluate(`(() => {const input=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const click=async text=>{await waitFor(`[...document.querySelectorAll('button')].some(button=>button.textContent===${JSON.stringify(text)} && !button.disabled)`,`button ${text}`);return evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)} && !button.disabled).click()`);};
  try {
    await window.loadURL(`${origin}/konga`);
    await waitFor("!!document.querySelector('[aria-label=\"Kong Admin URL\"]')",'gateway connection');
    await input('Kong Admin URL',`http://127.0.0.1:${server.address().port}`); await click('Hubungkan');
    await waitFor("!document.querySelector('[aria-label=\"Kong Admin URL\"]')",'connected');
    await click('Tambah service'); await input('Nama gateway','synthetic-service'); await input('Upstream URL','http://127.0.0.1:4000'); await click('Simpan');
    await waitFor("!document.querySelector('[role=dialog]') && document.body.textContent.includes('synthetic-service')",'create service');
    await click('Edit'); await input('Nama gateway','synthetic-service-edited'); await click('Simpan');
    await waitFor("!document.querySelector('[role=dialog]') && document.body.textContent.includes('synthetic-service-edited')",'update service');
    await click('Routes');
    await waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent==='Tambah route' && !button.disabled)",'routes loaded');
    await click('Tambah route');
    await waitFor("!!document.querySelector('[aria-label=\"Route service\"]:not(:disabled)') && [...document.querySelectorAll('[role=dialog] button')].some(button=>button.textContent==='Simpan' && !button.disabled)",'route form');
    await input('Nama gateway','synthetic-route'); await input('Route paths','/synthetic');
    await evaluate("document.querySelector('[aria-label=\"Route service\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
    await waitFor("document.querySelectorAll('[role=option]').length===2",'service selector');
    await evaluate("[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('synthetic-service-edited')).click()"); await click('Simpan');
    await waitFor("!document.querySelector('[role=dialog]') && document.body.textContent.includes('synthetic-route')",'create route');
    await click('Edit'); await input('Route paths','/synthetic-v2'); await click('Simpan');
    await waitFor("!document.querySelector('[role=dialog]') && document.body.textContent.includes('/synthetic-v2')",'update route');
    fs.writeFileSync(path.join(directory,'konga-smoke.png'),(await window.webContents.capturePage()).toPNG());
    await click('Hapus'); await click('Lanjutkan');
    await waitFor("document.body.textContent.includes('Belum ada data.')",'delete route');
    await click('Services'); await waitFor("document.body.textContent.includes('synthetic-service-edited')",'reload services'); await click('Hapus'); await click('Lanjutkan');
    await waitFor("document.body.textContent.includes('Belum ada data.')",'delete service');
    for (const operation of ['POST:services','PATCH:services','DELETE:services','POST:routes','PATCH:routes','DELETE:routes']) if(!operations.includes(operation))throw new Error(`Missing gateway operation ${operation}`);
    console.log('KONGA_UI_SMOKE_OK',JSON.stringify({crud:true,fixture:'local-synthetic',operations:operations.length}));
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
module.exports={verifyKonga};
