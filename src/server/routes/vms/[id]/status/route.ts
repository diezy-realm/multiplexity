import { getServerSession } from '@/server/auth/session';
import { getVMStatus, checkVMConnectivity } from '@/lib/vm/vm-manager';
import { getDb } from '@/lib/db';

/**
 * GET /api/vms/:id/status — Get VM status (performs live connectivity check)
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

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return Response.json(
      { error: 'Invalid VM id' },
      { status: 400 }
    );
  }

  const sanitizedId = id.trim().replace(/[^a-f0-9]/gi, '');
  if (sanitizedId.length === 0 || sanitizedId !== id.trim()) {
    return Response.json(
      { error: 'Invalid VM id format' },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    // Get VM host/port for connectivity check
    const vm = db.prepare('SELECT host, port FROM vms WHERE id = ?').get(sanitizedId) as { host: string; port: number } | undefined;

    if (!vm) {
      return Response.json({ error: 'VM not found' }, { status: 404 });
    }

    // Perform live TCP connectivity check (5 second timeout)
    const isOnline = await checkVMConnectivity(vm.host, vm.port, 5000);

    // Get current status from DB
    const currentRow = db.prepare('SELECT fail_count FROM vm_status WHERE vm_id = ?').get(sanitizedId) as { fail_count: number } | undefined;
    const currentFailCount = currentRow?.fail_count ?? 0;

    let newStatus: 'online' | 'offline' | 'unreachable';
    let newFailCount: number;

    if (isOnline) {
      newStatus = 'online';
      newFailCount = 0;
    } else {
      newFailCount = currentFailCount + 1;
      newStatus = newFailCount >= 3 ? 'unreachable' : 'offline';
    }

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

    // Update status in DB
    db.prepare(
      `INSERT INTO vm_status (vm_id, status, last_checked, fail_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vm_id) DO UPDATE SET status = ?, last_checked = ?, fail_count = ?`
    ).run(sanitizedId, newStatus, now, newFailCount, newStatus, now, newFailCount);

    return Response.json({
      vmId: sanitizedId,
      status: newStatus,
      lastChecked: now,
      failCount: newFailCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return Response.json({ error: 'VM not found' }, { status: 404 });
    }
    return Response.json(
      { error: 'Failed to retrieve VM status' },
      { status: 500 }
    );
  }
}
