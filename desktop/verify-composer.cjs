const fs=require('node:fs');const path=require('node:path');
async function verifyComposer(window,origin,directory){
  const evaluate=code=>window.webContents.executeJavaScript(code,true);
  async function waitFor(code,label){const deadline=Date.now()+20000;while(!await evaluate(code)){if(Date.now()>deadline)throw new Error('Composer UI timeout: '+label);await new Promise(resolve=>setTimeout(resolve,100));}}
  const click=label=>evaluate(`document.querySelector('[aria-label="${label}"]').click()`);
  const capture=async name=>{await new Promise(resolve=>setTimeout(resolve,250));fs.writeFileSync(path.join(directory,name),(await window.webContents.capturePage()).toPNG());};
  const draft=value=>evaluate(`(()=>{const input=document.querySelector('[aria-label="Pesan chat"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await window.loadURL(origin+'/chat?vm=synthetic-composer&kind=systemd&target=fixture.service');
  await waitFor("!!document.querySelector('textarea:not(:disabled)')",'composer mounted');
  await evaluate(`(()=>{window.__composerCalls=[];const original=window.fetch.bind(window);window.fetch=(url,options)=>{
    if(url==='/api/ai/chat'&&options?.method==='POST'){window.__composerCalls.push(JSON.parse(options.body));return Promise.resolve(new Response(JSON.stringify({message:'Synthetic composer answer'}),{headers:{'Content-Type':'application/json'}}));}
    return original(url,options);
  };})()`);
  await click('Tambah ke chat');
  await waitFor("!!document.querySelector('[aria-label=\"Pilihan chat\"]')",'menu');
  await evaluate("[...document.querySelectorAll('.composer-popup button')].find(button=>button.textContent==='Log + resource').click()");
  await waitFor("document.querySelector('[data-testid=\"composer-mode\"]')?.textContent.includes('Log + resource')",'single mode');
  if(!await evaluate("document.querySelectorAll('[data-testid=\"composer-mode\"]').length===1 && window.__composerCalls.length===0"))throw new Error('Mode selection executed a request');
  await draft('Synthetic diagnostics');await click('Kirim pesan');
  await waitFor("!document.querySelector('[aria-label=\"Hentikan respons\"]') && window.__composerCalls.length===1",'mode payload');
  if(!await evaluate("window.__composerCalls[0].diagnostic==='logs' && window.__composerCalls[0].includeResources && window.__composerCalls[0].sources.length===1"))throw new Error('Incorrect mode request');
  await click('Hapus mode Log + resource');await draft('Synthetic plain chat');await click('Kirim pesan');
  await waitFor("!document.querySelector('[aria-label=\"Hentikan respons\"]') && window.__composerCalls.length===2",'ordinary payload');
  if(!await evaluate("window.__composerCalls[1].sources.length===0 && !window.__composerCalls[1].includeResources"))throw new Error('Inactive sources were sent');
  await draft('!status Check fixture');
  await waitFor("document.querySelector('[data-testid=\"composer-mode\"]')?.textContent.includes('Status service')",'shortcut mode');
  await click('Tambah ke chat');
  await evaluate("document.querySelector('[aria-label=\"Tutup pilihan\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await waitFor("document.activeElement?.getAttribute('aria-label')==='Tambah ke chat'",'focus returned');
  await click('Tambah ke chat');
  await capture('composer-menu.png');
  await click('Tutup pilihan');
  const geometry=()=>evaluate(`(()=>{const composer=document.querySelector('.chat-composer');const box=composer.getBoundingClientRect();const send=composer.querySelector('[aria-label="Kirim pesan"]').getBoundingClientRect();return composer.scrollWidth<=composer.clientWidth+1 && send.right<=box.right && send.bottom<=box.bottom;})()`);
  if(!await geometry())throw new Error('Main composer overflows');
  await evaluate("document.documentElement.classList.remove('dark')");
  await capture('composer-light.png');
  await evaluate(`fetch('/api/appearance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'dark',fontFamily:'Segoe UI',fontSize:16,terminalFontSize:14,colors:{'editor.background':'#171b2b','editor.foreground':'#e1e5f2','sideBar.background':'#202638','sideBar.foreground':'#e1e5f2','input.background':'#202638','input.foreground':'#e1e5f2','panel.border':'#47516b'}})}).then(response=>{if(!response.ok)throw new Error('Synthetic theme failed');window.dispatchEvent(new Event('appearance-updated'));})`);
  await waitFor("document.documentElement.classList.contains('dark') && document.documentElement.dataset.customTheme==='true'",'custom theme applied');
  await capture('composer-dark.png');
  await click('Buka Chat kanan');
  await waitFor("!!document.querySelector('[aria-label=\"Panel kanan\"] textarea:not(:disabled)')",'embedded composer');
  if(!await evaluate(`(()=>{const composer=document.querySelector('[aria-label="Panel kanan"] .chat-composer');const rect=composer.getBoundingClientRect();const send=composer.querySelector('[aria-label="Kirim pesan"]').getBoundingClientRect();return composer.scrollWidth<=composer.clientWidth+1 && send.right<=rect.right && !!composer.querySelector('.composer-context-summary');})()`))throw new Error('Embedded composer overflows or context is not collapsed');
  await capture('composer-embedded.png');
  const media=await window.webContents.debugger;
  if(!media.isAttached())media.attach('1.3');
  await media.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click('Tambah ke chat');
  if(!await evaluate("getComputedStyle(document.querySelector('.composer-popup')).animationName==='none'"))throw new Error('Reduced motion not honored');
  await media.sendCommand('Emulation.setEmulatedMedia',{features:[]});media.detach();
  console.log('COMPOSER_UI_SMOKE_OK',JSON.stringify({singleMode:true,payload:true,inactiveSources:true,keyboard:true,lightDarkCustom:true,embedded:true,reducedMotion:true}));
  console.log('COMPOSER_SCREENSHOTS',directory);
}
module.exports={verifyComposer};
