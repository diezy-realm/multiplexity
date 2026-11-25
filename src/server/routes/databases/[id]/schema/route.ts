import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * GET /api/databases/[id]/schema — List all databases on the server
 *
 * Returns the list of databases available on the connected database server.
 * Handles "Access denied" errors gracefully — if a database listing partially
 * fails, it still returns accessible databases.
 *
 * Requirements: 4.1, 4.4
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

    // Ensure connection is active (auto-connect if needed)
    const dbManager = getDatabaseManager();
    let connection = dbManager.getConnection(id);
    if (!connection || connection.status !== 'connected') {
      await dbManager.connect(id);
    }

    // Get list of databases
    const queryExecutor = getQueryExecutor();
    const databases = await queryExecutor.getDatabases(id);

    return Response.json({ databases });
  } catch (error: any) {
    // Handle "Access denied" gracefully
    const message = error?.message || '';
    if (message.toLowerCase().includes('access denied')) {
      return Response.json(
        { databases: [], error: 'Access denied: insufficient privileges to list databases' },
        { status: 200 }
      );
    }

    return Response.json(
      { error: 'Failed to retrieve databases' },
      { status: 500 }
    );
  }
}
