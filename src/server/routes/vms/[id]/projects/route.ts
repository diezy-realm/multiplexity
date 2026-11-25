import { getServerSession } from '@/server/auth/session';
import { getLogReader } from '@/lib/logs/log-reader';

/**
 * Validates a VM ID — must be non-empty hex characters only.
 */
function isValidVmId(id: string): boolean {
  return /^[a-f0-9]+$/i.test(id);
}

/**
 * GET /api/vms/:id/projects — List projects on a VM
 */
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
    return Response.json(
      { error: 'Invalid VM id format' },
      { status: 400 }
    );
  }

  try {
    const logReader = getLogReader();
    const projects = await logReader.listProjects(id);
    return Response.json(projects);
  } catch (error) {
    return Response.json(
      { error: 'Failed to retrieve projects' },
      { status: 500 }
    );
  }
}
