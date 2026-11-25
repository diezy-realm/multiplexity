import { getServerSession } from '@/server/auth/session';
import { getServiceDetector } from '@/lib/services/service-detector';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';

/**
 * Validates a VM ID — must be non-empty alphanumeric characters.
 */
function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

/**
 * GET /api/vms/:id/services — Detect and return running services on a VM
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
    const detector = getServiceDetector();
    const result = await detector.detectServices(id);
    return Response.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshErrorInfo = handleSSHError(err);

    return Response.json(
      {
        error: sshErrorInfo.message || 'Failed to detect running services',
        details: err.message,
      },
      { status: 500 }
    );
  }
}
