export function isLocalDevelopment(): boolean {
  if(process.env.NODE_ENV!=='development'||process.env.MANAGER_LOCAL_DEV!=='1'||process.env.DESKTOP_MODE==='1')return false;
  try {
    const origin=new URL(process.env.NEXTAUTH_URL||'');
    return origin.protocol==='http:'&&origin.hostname==='localhost'&&origin.origin===process.env.NEXTAUTH_URL;
  }catch{return false;}
}
export function canUseLocalCli(): boolean { return process.env.DESKTOP_MODE==='1'||isLocalDevelopment(); }
export function hasLocalWebAccess(request:Request): boolean {
  if(!isLocalDevelopment())return false;
  const origin=process.env.NEXTAUTH_URL!;
  // Validate the browser-facing Host independently of the internal listener address.
  return request.headers.get('host')===new URL(origin).host&&(!request.headers.get('origin')||request.headers.get('origin')===origin);
}
