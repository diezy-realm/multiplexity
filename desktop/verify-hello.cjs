async function verifyHello(window, origin, password) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  async function waitFor(code, label) {
    const deadline=Date.now()+20000;
    while(!await evaluate(code)){if(Date.now()>deadline)throw new Error(`Hello smoke timeout: ${label}`);await new Promise(resolve=>setTimeout(resolve,100));}
  }
  const input = (label,value) => evaluate(`(() => { const input=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const click = text => evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
  window.webContents.debugger.attach('1.3');
  const send = (method,params={})=>window.webContents.debugger.sendCommand(method,params);
  let authenticator;
  try {
    await send('WebAuthn.enable',{enableUI:false});
    authenticator=(await send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
    await window.loadURL(`${origin}/settings`);
    await waitFor("!!document.querySelector('[aria-label=\"Password saat ini\"]')",'account settings');
    await input('Password saat ini',password);
    await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent === 'Aktifkan Windows Hello' && !b.disabled)",'platform authenticator availability');
    await click('Aktifkan Windows Hello');
    await waitFor("document.body.textContent.includes('Windows Hello aktif')",'registration');
    await evaluate("document.querySelector('[aria-label=\"Logout\"]').click()");
    await waitFor("!!document.querySelector('#username')",'logout');
    await evaluate(`(() => {const input=document.getElementById('username');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'desktop-smoke');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('Forget Password');
    await click('Verifikasi Windows Hello');
    await waitFor("!!document.querySelector('[aria-label=\"Password pemulihan baru\"]')",'authentication');
    const recovered='synthetic-recovered-password';
    await input('Password pemulihan baru',recovered);
    await click('Reset Password');
    await waitFor("document.body.textContent.includes('Password diganti.')",'password reset');
    await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Tutup\"]').click()");
    await evaluate(`(() => {const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['username','desktop-smoke'],['password',${JSON.stringify(recovered)}]]){const input=document.getElementById(id);setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await waitFor("!document.querySelector('button[type=submit]').disabled",'login readiness');
    await evaluate("document.querySelector('button[type=submit]').click()");
    await waitFor("location.pathname === '/' && [...document.querySelectorAll('h1')].some(h=>h.textContent==='Virtual Machines')",'login with recovered password');
    console.log('WINDOWS_HELLO_VIRTUAL_SMOKE_OK',JSON.stringify({registration:true,authentication:true,passwordReset:true,relogin:true}));
  } finally {
    if(authenticator)await send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:authenticator});
    window.webContents.debugger.detach();
  }
}
module.exports={verifyHello};
