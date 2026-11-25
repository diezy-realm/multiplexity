import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import {
  getDatabaseManager,
  DatabaseCredentialError,
  DatabaseServerError,
} from '@/lib/db/database-manager';

/**
 * POST /api/databases/[id]/connect — Establish database connection
 *
 * Creates an SSH tunnel to the VM and connects the database client.
 * Returns success or an appropriate error based on failure type:
 * - 401: Credential error (wrong username/password)
 * - 503: Database server not running
 * - 500: Other errors
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

    // Attempt to connect
    const dbManager = getDatabaseManager();
    await dbManager.connect(id);

    return Response.json({
      id,
      status: 'connected',
      message: 'Database connection established successfully',
    });
  } catch (error) {
    if (error instanceof DatabaseCredentialError) {
      return Response.json(
        { error: error.message },
        { status: 401 }
      );
    }

    if (error instanceof DatabaseServerError) {
      return Response.json(
        { error: error.message },
        { status: 503 }
      );
    }

    return Response.json(
      { error: 'Failed to connect to database' },
      { status: 500 }
    );
  }
}
