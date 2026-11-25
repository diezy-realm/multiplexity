import { getServerSession } from '@/server/auth/session';
import { getResourceMonitor } from '@/lib/services/resource-monitor';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

export async function GET(
  _request: Request,
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

  try {
    const monitor = getResourceMonitor();
    const resources = await monitor.getResources(id);
    return Response.json(resources);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshError = handleSSHError(err);
    return Response.json(
      { error: sshError.message || 'Failed to fetch VM resources', details: err.message },
      { status: 500 }
    );
  }
}
