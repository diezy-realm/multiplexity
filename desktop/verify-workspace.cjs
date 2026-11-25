const fs = require('node:fs');
const path = require('node:path');

async function verifyWorkspace(window, origin, directory) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  async function waitFor(code, label) {
    const deadline = Date.now() + 20000;
    while (!await evaluate(code)) {
      if (Date.now() > deadline) throw new Error(`Workspace smoke timeout: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await evaluate(`Promise.all([
    fetch('/api/artifacts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'artifacts/synthetic-analysis.md',content:'# Analysis\\nSynthetic evidence only.'})}),
    fetch('/api/snippets', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Synthetic credential',kind:'credential',content:'synthetic-only'})})
  ]).then(results=>{if(results.some(response=>!response.ok))throw new Error('Workspace fixture failed');})`);
  window.setSize(1360, 850);
  await window.loadURL(`${origin}/artifacts`);
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.title==='artifacts/synthetic-analysis.md')", 'artifact list');
  await evaluate("document.querySelector('button[title=\"artifacts/synthetic-analysis.md\"]').click()");
  await waitFor("document.querySelector('[aria-label=\"Isi artifact\"]').value.includes('Synthetic evidence')", 'artifact preview');
  await evaluate("document.querySelector('[aria-label=\"Buka Snipet\"]').click()");
  await waitFor("document.querySelector('[aria-label=\"Panel kanan\"]').textContent.includes('Synthetic credential')", 'snippet list');
  if (await evaluate("!!document.querySelector('[aria-label=\"Judul snipet\"]')")) throw new Error('Snippet editor opened without a request');
  window.show(); window.focus();
  await new Promise(resolve=>setTimeout(resolve,300));
  await evaluate("document.querySelector('[aria-label=\"Salin Synthetic credential\"]').click()");
  await waitFor("document.querySelector('[aria-label=\"Panel kanan\"]').textContent.includes('Synthetic credential disalin')",'snippet click copies');
  if (await evaluate("!!document.querySelector('[aria-label=\"Isi snipet\"]')")) throw new Error('Credential content was exposed');
  await evaluate("[...document.querySelectorAll('[aria-label=\"Panel kanan\"] button')].find(b=>b.textContent==='Tambah baru').click()");
  await waitFor("!!document.querySelector('[aria-label=\"Isi snipet\"]')",'snippet editor on demand');
  await evaluate("[...document.querySelectorAll('[aria-label=\"Panel kanan\"] button')].find(b=>b.textContent==='Batal').click()");
  fs.writeFileSync(path.join(directory, 'artifact-snippet-smoke.png'), (await window.webContents.capturePage()).toPNG());
  await window.loadURL(`${origin}/settings`);
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Appearance')", 'appearance settings');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Appearance').click()");
  await evaluate(`(() => {
    const input=document.querySelector('input[type=file]');
    const transfer=new DataTransfer();
    transfer.items.add(new File(['{ // VS Code color theme\\n "type":"dark", "colors":{"editor.background":"#17202b","terminal.ansiRed":"#f44747"}, }'],'synthetic-theme.jsonc',{type:'application/json'}));
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor("document.documentElement.style.getPropertyValue('--custom-base')==='#17202b'", 'JSONC color theme import');
  await window.loadURL(`${origin}/settings`);
  await waitFor("document.documentElement.style.getPropertyValue('--custom-base')==='#17202b'", 'appearance persistence');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Appearance').click()");
  fs.writeFileSync(path.join(directory, 'settings-smoke.png'), (await window.webContents.capturePage()).toPNG());
  console.log('WORKSPACE_UI_SMOKE_OK', JSON.stringify({artifacts:true,maskedSnippet:true,vscodeJsonc:true,appearancePersistence:true}));
  console.log('WORKSPACE_SCREENSHOT', path.join(directory, 'artifact-snippet-smoke.png'));
  await window.loadURL(`${origin}/chat`);
  await waitFor("!!document.querySelector('[aria-label=\"Pesan chat\"]:not(:disabled)')",'chat loaded');
  await evaluate(`(() => {const original=window.fetch.bind(window);window.fetch=(url,options)=>url==='/api/ai/chat' && !options?.method?Promise.resolve(new Response(JSON.stringify({messages:[{role:'assistant',content:'# Synthetic analysis\\n\\n**Evidence**\\n\\n| Source | State |\\n| --- | --- |\\n| Synthetic | OK |\\n\\ninline code'}]}),{headers:{'Content-Type':'application/json'}})):original(url,options);window.dispatchEvent(new Event('chat-updated'));})()`);
  await waitFor("!!document.querySelector('.markdown-output strong') && !!document.querySelector('.markdown-output table')",'chat Markdown');
  await evaluate("document.querySelector('[aria-label=\"Buka Chat kanan\"]').click()");
  await waitFor("document.querySelectorAll('.markdown-output strong').length===2",'right chat Markdown');
  await evaluate("document.querySelector('[aria-label=\"Tutup panel kanan\"]').click()");
  await evaluate("document.querySelector('[aria-label=\"Pengaturan AI\"]').click()");
  await evaluate("document.querySelector('[aria-label=\"Permission\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
  await waitFor("document.querySelectorAll('[role=option]').length===3",'permission popup');
  fs.writeFileSync(path.join(directory,'markdown-dropdown-smoke.png'),(await window.webContents.capturePage()).toPNG());
  await evaluate("[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('Read only')).click()");
  console.log('PRESENTATION_UI_SMOKE_OK',JSON.stringify({markdown:true,rightChat:true,customDropdown:true,snippetCopy:true}));
}
module.exports = { verifyWorkspace };
