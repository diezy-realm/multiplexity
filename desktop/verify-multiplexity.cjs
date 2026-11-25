const fs = require('node:fs');
const path = require('node:path');
async function verifyMultiplexity(window, origin, directory) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  async function waitFor(code) {
    const until=Date.now()+15000;
    while(!await evaluate(code)) {if(Date.now()>until) throw new Error('Multiplexity UI assertion timeout: '+code);await new Promise(resolve=>setTimeout(resolve,100));}
  }
  await window.loadURL(origin+'/chat');
  await waitFor("!!document.querySelector('textarea:not(:disabled)')");
  const nav = await evaluate("Array.from(document.querySelectorAll('nav[aria-label=\"Navigasi utama\"] a')).map(a=>a.textContent).join('|')");
  if(nav!=='Chat|VM Machines|Databases|Konga|Artifact') throw new Error('Navigation order mismatch');
  if(await evaluate("document.querySelectorAll('[data-testid=\"page-header\"]').length!==1 || !!document.querySelector('input[placeholder=\"Default CLI\"]') || !!document.querySelector('[aria-label=\"Toggle right window\"]')")) throw new Error('Page chrome is inconsistent');
  await evaluate("document.querySelector('[aria-label=\"Tambah ke chat\"]').click();document.querySelector('[aria-label=\"Lampirkan Artifact\"]').click()");
  await waitFor("!!document.querySelector('[aria-label=\"Pilihan chat\"]')");
  await evaluate("document.querySelector('[aria-label=\"Tutup pilihan\"]').click()");
  await waitFor("!document.querySelector('[aria-label=\"Pilihan chat\"]')");
  await evaluate(`(() => {
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'clipboard.png',{type:'image/png'}));
    document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  })()`);
  await waitFor("!!document.querySelector('img[alt=\"clipboard.png\"]')");
  await evaluate("document.querySelector('[aria-label=\"Pengaturan AI\"]').click()");
  const before=await evaluate("document.querySelector('form').getBoundingClientRect().height");
  await evaluate(`(() => {const original=window.fetch.bind(window);window.fetch=(url,options)=>String(url).startsWith('/api/ai/models')?Promise.resolve(new Response(JSON.stringify({models:[{id:'synthetic-model-with-long-name',name:'Synthetic vision model with a long label'}]}),{headers:{'Content-Type':'application/json'}})):original(url,options);document.querySelector('[aria-label="Muat model"]').click();})()`);
  await waitFor("document.querySelector('[aria-label=\"Pilihan chat\"]').textContent.includes('1 model')");
  const after=await evaluate("document.querySelector('form').getBoundingClientRect().height");
  await evaluate("document.querySelector('[aria-label=\"Tutup pilihan\"]').click()");
  if(Math.abs(before-after)>2) throw new Error('Model refresh moved composer controls');
  await evaluate(`(() => {const original=window.fetch.bind(window);window.fetch=(url,options)=>url==='/api/ai/chat'&&!options?.method?Promise.resolve(new Response(JSON.stringify({messages:[{role:'user',content:'Synthetic question',created_at:new Date().toISOString()},{role:'assistant',content:'\`\`\`sh\\necho synthetic\\n\`\`\`',created_at:new Date().toISOString()}]}),{headers:{'Content-Type':'application/json'}})):original(url,options);window.dispatchEvent(new Event('chat-updated'));})()`);
  await waitFor("!!document.querySelector('[aria-label=\"Copy code\"]') && !!document.querySelector('[aria-label=\"Edit message\"]')");
  await new Promise(resolve=>setTimeout(resolve,300));
  fs.writeFileSync(path.join(directory,'multiplexity-chat.png'),(await window.webContents.capturePage()).toPNG());
  console.log('MULTIPLEXITY_UI_SMOKE_OK',JSON.stringify({navigation:true,pasteImage:true,artifactToggle:true,modelRefreshStable:true,codeActions:true}));
  console.log('MULTIPLEXITY_SCREENSHOT',path.join(directory,'multiplexity-chat.png'));
}
module.exports={verifyMultiplexity};
