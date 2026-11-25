import { getServerSession } from '@/server/auth/session';
import { getDatabaseManager } from '@/lib/db/database-manager';
import { getDb } from '@/lib/db';

/**
 * GET /api/databases/[id]/status — Check database connection status
 *
 * Returns the connection status: 'connected', 'disconnected', or 'unreachable'.
 * Checks VM status first before attempting database connectivity test.
 *
 * Requirements: 2.2, 2.3, 2.4
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

  try {
    // Verify the connection exists
    const db = getDb();
    const row = db.prepare(
      'SELECT id FROM database_connections WHERE id = ?'
    ).get(id) as { id: string } | undefined;

    if (!row) {
      return Response.json(
        { error: 'Database connection not found' },
        { status: 404 }
      );
    }

    // Use DatabaseManager.getStatus() which checks VM status first,
    // then tests database connectivity
    const dbManager = getDatabaseManager();
    const status = await dbManager.getStatus(id);

    return Response.json({
      id,
      status,
    });
  } catch (error) {
    return Response.json(
      { error: 'Failed to retrieve database connection status' },
      { status: 500 }
    );
  }
}
