const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { waitFor, painted } = require('./code-review-flow.cjs');

async function verifyAIProviders(evaluate, capture) {
  const models = [{ id: 'fixture-chat', name: 'Fixture chat' }, { id: 'fixture-alt', name: 'Fixture alternate' }];
  const server = createServer((request, response) => {
    if (request.url !== '/v1/models') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: models }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const query = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const button = (label, scope = 'document') => '[...' + scope + ".querySelectorAll('button')].find(el => el.textContent.trim() === " + JSON.stringify(label) + ' && !el.disabled)';
  const click = async (expression, title) => {
    await waitFor(evaluate, 'Boolean(' + expression + ')', title);
    await evaluate(expression + '.click()');
  };
  const fill = (selector, value) => evaluate(`(() => {
    const field = ${query(selector)};
    Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const screenshot = async name => {
    if (!capture) return;
    await evaluate(painted);
    await capture(name);
  };
  try {
    await evaluate("location.assign('/settings?section=ai'); true").catch(() => {});
    await waitFor(evaluate, "Boolean(document.querySelector('.ai-provider-settings'))", 'AI Provider page');
    await click(button('Tambah provider'), 'open provider wizard');
    assert.equal(await evaluate("[...document.querySelectorAll('dialog label')].some(el => el.textContent.includes('OpenRouter'))"), true);
    const choice = "[...document.querySelectorAll('dialog label')].find(el => el.textContent.includes('OpenAI-Compatible API')).querySelector('input')";
    await click(choice, 'select custom provider');
    await click(button('Lanjut', 'document.querySelector("dialog")'), 'open identity step');
    await fill('dialog input[required]', 'Provider Fixture');
    await fill('dialog textarea', 'Koneksi pengujian lokal');
    await click(button('Lanjut', 'document.querySelector("dialog")'), 'open configuration step');
    await fill('dialog input.ai-code', `http://127.0.0.1:${server.address().port}/v1`);
    assert.equal(await evaluate("document.querySelector('dialog button[type=submit]').disabled"), true);
    await click(button('Test connection', 'document.querySelector("dialog")'), 'test provider without saving');
    await waitFor(evaluate, "document.querySelector('dialog .ai-probe-ok')?.textContent.includes('2 model')", 'provider probe result');
    const draftSaved = await evaluate("fetch('/api/ai/settings').then(r=>r.json()).then(value=>value.connections.find(item=>item.provider==='custom').saved)");
    assert.equal(draftSaved, false);
    await fill('dialog select', 'fixture-chat');
    await screenshot('wizard');
    await click(button('Tambah provider', 'document.querySelector("dialog")'), 'save verified provider');
    await waitFor(evaluate, "document.querySelector('.ai-detail-heading h3')?.textContent === 'Provider Fixture'", 'provider detail');
    const selectedModel = await evaluate("fetch('/api/ai/settings').then(r=>r.json()).then(value=>value.model)");
    assert.equal(selectedModel, 'fixture-chat');
    await screenshot('detail');
    const modelSwitch = query('[aria-label="Aktifkan model fixture-alt"]');
    await click(modelSwitch, 'disable alternate model');
    await click(button('Simpan'), 'save model availability');
    await waitFor(evaluate, "document.body.textContent.includes('Konfigurasi provider disimpan.')", 'model saved');
    const listed = await evaluate("fetch('/api/ai/models?provider=custom').then(r=>r.json()).then(value=>value.models.map(item=>item.id))");
    assert.deepEqual(listed, ['fixture-chat']);
    const providerSwitch = query('[aria-label="Aktifkan provider Provider Fixture"]');
    await click(providerSwitch, 'turn off configured provider');
    await waitFor(evaluate, providerSwitch + "?.getAttribute('aria-checked') === 'false'", 'provider disabled');
    await click(query('a[href="/chat"]'), 'open chat with disabled provider');
    await waitFor(evaluate, "document.querySelector('a[href=\"/settings?section=ai\"]')?.textContent.includes('Atur AI Provider')", 'chat directs to settings');
  } catch (error) {
    const status = await evaluate("({ path: location.pathname + location.search, alert: document.querySelector('.ai-provider-settings [role=alert]')?.textContent, buttons: [...document.querySelectorAll('.ai-provider-settings button')].slice(0,4).map(button => [button.textContent.trim(), button.disabled]) })").catch(() => null);
    throw new Error(error.message + ' ' + JSON.stringify(status));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { verifyAIProviders };
