import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { getQueryExecutor } from '@/lib/db/query-executor';
import { getDatabaseManager } from '@/lib/db/database-manager';

/**
 * GET /api/databases/[id]/schema/[db]/[table] — Get table structure
 *
 * Returns the column information for a specific table including
 * column names, types, nullable, primary key, and default values.
 *
 * Requirements: 4.3, 4.4
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; db: string; table: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, db: database, table } = params;

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

    // Get table structure
    const queryExecutor = getQueryExecutor();
    const columns = await queryExecutor.getTableStructure(id, database, table);

    return Response.json({ database, table, columns });
  } catch (error: any) {
    // Handle "Access denied" gracefully
    const message = error?.message || '';
    if (message.toLowerCase().includes('access denied')) {
      return Response.json(
        { database, table, columns: [], error: `Access denied: insufficient privileges to access table '${table}' in database '${database}'` },
        { status: 200 }
      );
    }

    return Response.json(
      { error: 'Failed to retrieve table structure' },
      { status: 500 }
    );
  }
}
