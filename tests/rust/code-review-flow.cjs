const assert = require('node:assert/strict');

const button = label => "[...document.querySelectorAll('button')].find(el => el.getClientRects().length && el.textContent.trim() === " + JSON.stringify(label) + ')';
const text = (value, scope = 'document.body') => scope + '?.innerText.includes(' + JSON.stringify(value) + ')';
const painted = "new Promise(resolve => { setTimeout(resolve, 250); requestAnimationFrame(() => requestAnimationFrame(resolve)); })";

async function waitFor(evaluate, expression, label) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error(label + ' timed out' + (lastError ? ' (' + lastError.message + ')' : ''));
}

async function click(evaluate, expression, label) {
  await waitFor(evaluate, 'Boolean(' + expression + ')', label);
  await evaluate(expression + '.click()');
}

async function loginFixture(evaluate, username) {
  await waitFor(evaluate, text('Buat Akun'), 'fixture account setup');
  await evaluate('(() => { const apply = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; ' +
    'for (const [name, value] of [[' + JSON.stringify('username') + ',' + JSON.stringify(username) + '],["password","test-password-code-review"]]) {' +
    'const field = document.querySelector("input[name=" + name + "]"); apply.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); } })()');
  await evaluate("document.querySelector('button[type=submit]').click()");
  await waitFor(evaluate, "location.pathname === '/' && " + text('Virtual Machines'), 'fixture sign in');
}

async function verifyCodeReview(evaluate, { capture, resize } = {}) {
  const query = value => 'document.querySelector(' + JSON.stringify(value) + ')';
  const sidebar = query('nav a[href="/code-review"]');
  await click(evaluate, sidebar, 'Code Review sidebar');
  await waitFor(evaluate, text('Siapkan GitHub Enterprise'), 'unconfigured state');
  await click(evaluate, button('Coba demo'), 'fixture mode toggle');
  await waitFor(evaluate, text('Gunakan tanggal UTC pada catatan rilis') + ' && ' + text('Deskripsi PR'), 'fixture summary');
  const queueTrigger = query('.review-open-queue');
  for (const [number, title] of [[18, 'Sertakan nomor rilis'], [17, 'Gunakan tanggal UTC']]) {
    if (await evaluate('Boolean(' + queueTrigger + '?.getClientRects().length)')) {
      await click(evaluate, queueTrigger, 'open queue for PR ' + number);
    }
    await click(evaluate, "[...document.querySelectorAll('.review-queue-item')].find(el => el.getClientRects().length && el.textContent.includes(" +
      JSON.stringify('#' + number) + '))', 'select PR ' + number);
    await waitFor(evaluate, text(title, query('.review-title')), 'selected PR ' + number);
  }
  const checks = query('.review-metadata');
  if (!(await evaluate(checks + '.open'))) await click(evaluate, query('.review-metadata summary'), 'checks control');
  await waitFor(evaluate, text('Visual preview') + ' && ' + text('Gagal') + ' && ' + text('Menunggu'), 'visible check outcomes');
  if (capture) {
    await evaluate(painted);
    await capture('summary');
  }

  const changes = query('[role="tab"][data-tab="changes"]');
  const summary = query('[role="tab"][data-tab="summary"]');
  await evaluate(summary + ".dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  await waitFor(evaluate, "new URLSearchParams(location.search).get('tab') === 'changes' && " + text('File berubah'), 'changes deep link');
  const files = query('[aria-labelledby] .review-file-list');
  await waitFor(evaluate, 'Boolean(' + files + ') && ' + text('src/format-date.ts'), 'file resource');
  const next = "[...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find(el => el.textContent.trim() === 'Muat berikutnya')";
  await click(evaluate, next, 'next file page');
  await click(evaluate, "[...document.querySelectorAll('.review-file-button')].find(el => el.textContent.includes('tests/release-date.test.ts'))", 'file on second page');
  await waitFor(evaluate, text('Patch terpotong'), 'truncated patch');
  await click(evaluate, "[...document.querySelectorAll('.review-file-button')].find(el => el.textContent.includes('src/format-date.ts'))", 'preview source file');

  const line5 = query('#review-line-right-5');
  const line6 = query('#review-line-right-6');
  await click(evaluate, line5, 'first context line');
  await evaluate(line6 + ".dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))");
  await click(evaluate, button('Ask AI'), 'Ask AI');
  await waitFor(evaluate, text('Baris baru 5–6'), 'range chip');
  await click(evaluate, button('Tinjau bukti'), 'evidence preview');
  const payload = query('pre[aria-label="Payload teredaksi"]');
  await waitFor(evaluate, 'Boolean(' + payload + ')', 'preview payload');
  const source = await evaluate('JSON.parse(' + payload + '.textContent).source');
  assert.equal(source.headSha, 'd9a302ba81cb0fcf7f548c13d34b92d76ca34710');
  assert.equal(source.path, 'src/format-date.ts');
  assert.equal(source.side, 'right');
  assert.deepEqual(source.lines.map(line => line.line), [5, 6]);
  if (capture) {
    await evaluate(painted);
    await capture('evidence');
  }
  await click(evaluate, button('Batal'), 'cancel before sending');
  await waitFor(evaluate, text('Dibatalkan.') + ' && !document.querySelector("[aria-label=\\"Analisis AI\\"]")', 'preview cancelled');
  await click(evaluate, button('Tinjau bukti'), 'reopen preview');
  await click(evaluate, button('Jalankan simulasi'), 'start cancellable analysis');
  await click(evaluate, button('Batalkan'), 'abort active analysis');
  await waitFor(evaluate, text('Dibatalkan.') + ' && !document.querySelector("[aria-label=\\"Analisis AI\\"]")', 'analysis cancelled');

  await click(evaluate, button('Tinjau bukti'), 'preview final request');
  await click(evaluate, button('Jalankan simulasi'), 'run fixture analysis');
  await waitFor(evaluate, 'Boolean(document.querySelector("[aria-label=\\"Analisis AI\\"]"))', 'fixture analysis result');
  await click(evaluate, button('Simpan sebagai Artifact'), 'save review artifact');
  const artifact = query('a[href^="/artifacts?name="]');
  await waitFor(evaluate, 'Boolean(' + artifact + ')', 'artifact link');
  const content = await evaluate('fetch("/api/artifacts?name=" + new URL(' + artifact + '.href).searchParams.get("name")).then(r => r.json()).then(v => v.content)');
  assert.ok(content.includes(source.headSha));
  assert.ok(content.includes('src/format-date.ts'));
  await click(evaluate, button('Ke baris sumber'), 'jump to evidence');
  await waitFor(evaluate, "document.activeElement?.id === 'review-line-right-5'", 'focus on anchored diff line');

  await evaluate('location.reload(); true').catch(() => {});
  await waitFor(evaluate, "location.pathname === '/code-review' && new URLSearchParams(location.search).get('tab') === 'changes' && " +
    changes + '?.getAttribute("aria-selected") === "true" && Boolean(' + line5 + ')', 'deep link after reload');
  if (resize) {
    await resize(840);
    const queue = query('.review-open-queue');
    await waitFor(evaluate, 'Boolean(' + queue + '?.getClientRects().length)', 'narrow queue trigger');
    await click(evaluate, queue, 'open narrow queue');
    const dialog = query('dialog[open]');
    await waitFor(evaluate, 'Boolean(' + dialog + ')', 'narrow queue dialog');
    await click(evaluate, query('dialog[open] button[aria-label="Tutup"]'), 'close narrow queue');
    await waitFor(evaluate, 'document.activeElement === ' + queue, 'return queue focus');
    await resize(1440);
  }
  await click(evaluate, query('a[href="/settings?section=integrations&connector=ghes"]'), 'Settings integration link');
  await waitFor(evaluate, text('CA perusahaan') + ' && ' + text('GitHub Enterprise Server'), 'GHES configuration entry');
  await evaluate("location.assign('/code-review?source=bitbucket'); true").catch(() => {});
  await waitFor(evaluate, text('Siapkan Bitbucket Data Center'), 'Bitbucket configuration state');
  await click(evaluate, query('a[href=\"/settings?section=integrations&connector=bitbucket\"]'), 'Bitbucket Settings integration link');
  await waitFor(evaluate, text('Personal HTTP access token (PAT)') + ' && ' + 'Boolean(' + query('input[placeholder=\"https://git.internal/bitbucket\"]') + ')', 'Bitbucket custom URL and PAT fields');
}

module.exports = { loginFixture, verifyCodeReview, waitFor };
