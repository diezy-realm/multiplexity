const fs = require('node:fs');
const path = require('node:path');

async function verifyUI(window, origin, directory) {
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function waitFor(code, label) {
    const deadline = Date.now() + 15000;
    while (!await evaluate(code)) {
      if (Date.now() > deadline) throw new Error(`UI smoke timeout: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const ids = await evaluate(`(async () => {
    const ids = [];
    for (const label of ['Synthetic VM A', 'Synthetic VM B']) {
      const response = await fetch('/api/vms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, host: '127.0.0.1', port: 1, username: 'synthetic', password: 'synthetic-unused-password' }) });
      if (!response.ok) throw new Error('Cannot create synthetic VM');
      ids.push((await response.json()).id);
    }
    await fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'vm-cards', order: ids }) });
    return ids;
  })()`);
  await window.loadURL(origin);
  await waitFor("document.querySelectorAll('[data-card-id]').length === 2", 'VM cards');
  await new Promise(resolve => setTimeout(resolve, 500));
  await evaluate(`document.querySelector('[data-card-id="${ids[0]}"] button[draggable]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  await waitFor(`document.querySelector('[data-card-id]').dataset.cardId === '${ids[1]}'`, 'keyboard reorder');
  await waitFor(`fetch('/api/preferences?scope=vm-cards').then(r=>r.json()).then(d=>d.order[0] === '${ids[1]}')`, 'persisted order');
  await evaluate(`(() => {
    window.__testTransfer = new DataTransfer();
    document.querySelector('[data-card-id="${ids[1]}"] button[draggable]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__testTransfer }));
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`(() => {
    const target = document.querySelector('[data-card-id="${ids[0]}"]');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__testTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__testTransfer }));
  })()`);
  await waitFor(`document.querySelector('[data-card-id]').dataset.cardId === '${ids[0]}'`, 'drag reorder');
  await evaluate(`document.querySelector('[aria-label="Connect to Synthetic VM A"]').click()`);
  await waitFor("document.querySelector('[aria-controls=\"vm-card-grid\"]').getAttribute('aria-expanded') === 'false' && !document.getElementById('vm-card-grid')", 'collapse on connect');
  await waitFor("!!document.querySelector('.xterm')", 'terminal mounted');
  const size = await evaluate("document.querySelector('.xterm').getBoundingClientRect().toJSON()");
  if (size.width < 700 || size.height < 200) throw new Error('Terminal does not fill the available space');
  await evaluate("document.querySelector('[aria-controls=\"vm-card-grid\"]').click()");
  await waitFor("!!document.getElementById('vm-card-grid') && !!document.querySelector('.xterm')", 'restore cards without closing terminal');
  await evaluate("document.querySelector('[aria-label^=\"Close terminal for\"]').click()");
  await waitFor("!document.querySelector('.xterm')", 'close terminal');
  await evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => typeof url === 'string' && url.endsWith('/${ids[0]}/services')
      ? Promise.resolve(new Response(JSON.stringify({ scannedAt: new Date().toISOString(), services: [
        { id: 'synthetic-a', name: 'synthetic-a.service', type: 'systemd', status: 'running', ports: [] },
        { id: 'synthetic-b', name: 'synthetic-b.service', type: 'systemd', status: 'running', ports: [] }
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(url, options);
    document.querySelector('[aria-label="Services for Synthetic VM A"]').click();
  })()`);
  await waitFor("document.querySelectorAll('[data-testid=\"services-modal\"] [data-card-id]').length === 2", 'service cards');
  await new Promise(resolve => setTimeout(resolve, 500));
  await evaluate("document.querySelector('[data-card-id=\"synthetic-a\"] button[draggable]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
  await waitFor("document.querySelector('[data-testid=\"services-modal\"] [data-card-id]').dataset.cardId === 'synthetic-b'", 'service reorder');
  await evaluate("document.querySelector('[data-testid=\"services-modal\"] button[aria-label=\"Tutup\"]').click()");
  await window.loadURL(`${origin}/chat`);
  await waitFor("!!document.querySelector('textarea[aria-label=\"Pesan chat\"]:not(:disabled)')", 'chat composer');
  const controls = await evaluate(`['AI provider', 'AI model', 'Tambah ke chat', 'Pengaturan AI'].every(label => document.querySelector('[aria-label="' + label + '"]'))`);
  if (!controls) throw new Error('Chat controls are incomplete');
  await evaluate("document.querySelector('[aria-label=\"Tambah ke chat\"]').click()");
  await waitFor("[...document.querySelectorAll('[aria-label=\"Pilihan chat\"] button')].some(node=>node.textContent.includes('Log + resource'))", 'mode picker');
  await evaluate("document.querySelector('[aria-label=\"Tutup pilihan\"]').click()");
  const order = await evaluate("[...document.querySelectorAll('nav[aria-label=\"Navigasi utama\"] a')].map(a=>a.title).join('|')");
  if (order !== 'Chat|VM Machines|Databases|Konga|Artifact') throw new Error('Sidebar order is incorrect');
  await evaluate("document.querySelector('[aria-label=\"Buka Snipet\"]').click()");
  await waitFor("!!document.querySelector('[aria-label=\"Panel kanan\"]')",'right snippet panel');
  await evaluate("document.querySelector('[aria-label=\"Tutup panel kanan\"]').click()");
  await evaluate("document.querySelector('[aria-label=\"Buka Chat kanan\"]').click()");
  await waitFor("document.querySelectorAll('[data-testid=\"chat-page\"]').length === 2",'right chat panel');
  await evaluate("document.querySelector('[aria-label=\"Tutup panel kanan\"]').click()");
  await window.loadURL(`${origin}/settings`);
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent === 'AI Management')",'settings navigation');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent === 'AI Management').click()");
  await evaluate("document.querySelector('button[title=\"AI Management\"]').click()");
  await waitFor("!!document.querySelector('[role=dialog] button[aria-label=\"Provider\"]')", 'AI settings');
  await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Provider\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
  await waitFor("document.querySelectorAll('[role=option]').length > 0",'provider options');
  const providers = await evaluate("document.querySelectorAll('[role=option]').length");
  if (providers !== 8) throw new Error('Provider choices are incomplete');
  await evaluate("document.querySelector('[role=option][data-value=codex]')?.click() || [...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('Codex CLI')).click()");
  await waitFor("!!document.querySelector('[role=dialog] input[aria-label=\"CLI executable\"]') && [...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent === 'Deteksi')", 'CLI discovery controls');
  if (process.argv.includes('--desktop-cli-smoke-test')) {
    const expected = path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    await waitFor(`document.querySelector('[aria-label="CLI executable"]').value === ${JSON.stringify(expected)}`, 'automatic standalone Codex detection');
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="CLI executable"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(path.dirname(expected))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent === 'Connect melalui CLI').click()");
    await waitFor("document.querySelector('[role=dialog]').textContent.includes('Selesaikan login')", 'connect without separate save');
    await waitFor(`document.querySelector('[aria-label="CLI executable"]').value === ${JSON.stringify(expected)}`, 'normalized folder path');
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent === 'Muat model').click()");
    await waitFor("document.querySelectorAll('#ai-models option').length > 0", 'models from detected Codex CLI');
    const count = await evaluate("document.querySelectorAll('#ai-models option').length");
    console.log('DESKTOP_CLI_SMOKE_OK', JSON.stringify({ detected: true, normalizedFolder: true, modelCount: count }));
  }
  await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Tutup\"]').click()");
  await waitFor("!document.querySelector('[role=dialog]')", 'settings close');
  await window.loadURL(`${origin}/chat`);
  await waitFor("!!document.querySelector('[data-testid=\"chat-page\"] form')",'return to chat');
  window.showInactive();
  await new Promise(resolve => setTimeout(resolve, 750));
  fs.writeFileSync(path.join(directory, 'chat-smoke.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(1000, 700);
  await evaluate("document.documentElement.classList.remove('dark')");
  await new Promise(resolve => setTimeout(resolve, 750));
  const fits = await evaluate(`(() => {
    const form = document.querySelector('[data-testid="chat-page"] form').getBoundingClientRect();
    return form.left >= 0 && form.right <= innerWidth && form.bottom <= innerHeight && form.top >= 0;
  })()`);
  if (!fits) throw new Error('Chat composer overflows the minimum desktop window');
  fs.writeFileSync(path.join(directory, 'chat-light-smoke.png'), (await window.webContents.capturePage()).toPNG());
  console.log('DESKTOP_UI_SMOKE_OK', JSON.stringify({ vmReorder: true, serviceReorder: true, collapse: true, chatControls: true, providerCount: providers }));
  console.log('DESKTOP_CHAT_SCREENSHOT', path.join(directory, 'chat-smoke.png'));
}

module.exports = { verifyUI };
