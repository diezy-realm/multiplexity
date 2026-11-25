import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * GET /api/databases/[id]/schema/[db] — List tables in a database
 *
 * Returns the list of tables in the specified database.
 * Handles "Access denied" errors gracefully per database.
 *
 * Requirements: 4.2, 4.4
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; db: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, db: database } = params;

  try {
    // Verify the connection exists
    const localDb = getDb();
    const row = localDb.prepare(
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

    // Get list of tables
    const queryExecutor = getQueryExecutor();
    const tables = await queryExecutor.getTables(id, database);

    return Response.json({ database, tables });
  } catch (error: any) {
    // Handle "Access denied" gracefully
    const message = error?.message || '';
    if (message.toLowerCase().includes('access denied')) {
      return Response.json(
        { database, tables: [], error: `Access denied: insufficient privileges to access database '${database}'` },
        { status: 200 }
      );
    }

    return Response.json(
      { error: 'Failed to retrieve tables' },
      { status: 500 }
    );
  }
}
