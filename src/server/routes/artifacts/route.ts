import { currentUserId } from '@/lib/user';
import { listWorkspace, readWorkspace, writeWorkspace, downloadWorkspace, isTextArtifact } from '@/lib/ai/workspace';
import { artifactVersions,artifactVersion,contentHash } from '@/lib/ai/workspace';

export async function GET(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url); const name = url.searchParams.get('name');
    if (!name) return Response.json(listWorkspace(user));
    if(url.searchParams.has('versions'))return Response.json({versions:artifactVersions(user,name)},{headers:{'Cache-Control':'no-store'}});
    const version=url.searchParams.get('version');
    if(version)return Response.json({name,...artifactVersion(user,name,version)},{headers:{'Cache-Control':'no-store'}});
    if (url.searchParams.has('download')) return new Response(downloadWorkspace(user, name), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name.split('/').pop()!)}`, 'Cache-Control': 'no-store' } });
    if (!isTextArtifact(name)) {
      if (!listWorkspace(user).files.some(file => file.name === name)) throw new Error();
      return Response.json({ name, content: '', downloadOnly: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const content = readWorkspace(user, name);
    return Response.json({ name, content,hash:contentHash(content) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'File tidak tersedia atau path tidak diizinkan.' }, { status: 400 }); }
}
export async function POST(request: Request) {
  const user = await currentUserId(); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.name !== 'string' || typeof body.content !== 'string') throw new Error();
    if(body.expectedHash!==undefined&&(typeof body.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedHash)))throw new Error();
    writeWorkspace(user, body.name, body.content,body.expectedHash);
    return Response.json({ success: true });
  } catch(error) { const conflict=error instanceof Error&&error.message.includes('File telah berubah');return Response.json({error:conflict?'File telah berubah. Muat ulang sebelum menyimpan.':'Nama atau isi file tidak valid.'},{status:conflict?409:400}); }
}
