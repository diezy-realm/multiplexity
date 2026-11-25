import { getServerSession } from '@/server/auth/session';
import { getGitManager } from '@/lib/services/git-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id || !isValidVmId(id)) {
    return Response.json({ error: 'Invalid VM id format' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path } = body;
  if (!path || typeof path !== 'string') {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }

  try {
    const gitManager = getGitManager();
    const result = await gitManager.pull(id, path);
    return Response.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshError = handleSSHError(err);
    return Response.json(
      { error: sshError.message || `Failed to run git pull in ${path}`, details: err.message },
      { status: 500 }
    );
  }
}
