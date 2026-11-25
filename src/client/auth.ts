export async function signIn(_provider: 'credentials', input: { username: string; password: string; redirect?: boolean }) {
  const csrf = await fetch('/api/auth/csrf').then(response => response.json());
  const response = await fetch('/api/auth/callback/credentials', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...input,csrfToken:csrf.csrfToken}) });
  if(!response.ok) return { error:'CredentialsSignin' };
  return { error:null };
}
export async function signOut({ callbackUrl='/login' }: {callbackUrl?:string} = {}) {
  const response=await fetch('/api/auth/csrf');
  if(!response.ok) throw new Error('Tidak dapat keluar. Coba lagi.');
  const csrf=await response.json();
  const result=await fetch('/api/auth/signout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrfToken:csrf.csrfToken,callbackUrl})});
  if(!result.ok) throw new Error('Tidak dapat keluar. Coba lagi.');
  window.location.assign((await result.json()).url);
}
