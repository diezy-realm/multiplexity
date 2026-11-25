import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * POST /api/databases/[id]/disconnect — Close database connection
 *
 * Closes the database client and associated SSH tunnel.
 * Returns success even if the connection was not active.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function POST(
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

    // Disconnect
    const dbManager = getDatabaseManager();
    await dbManager.disconnect(id);

    return Response.json({
      id,
      status: 'disconnected',
      message: 'Database connection closed successfully',
    });
  } catch (error) {
    return Response.json(
      { error: 'Failed to disconnect from database' },
      { status: 500 }
    );
  }
}
