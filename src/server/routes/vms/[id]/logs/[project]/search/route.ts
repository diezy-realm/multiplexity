import { getServerSession } from '@/server/auth/session';
import { getLogReader } from '@/lib/logs/log-reader';

/**
 * Validates a VM ID — must be non-empty hex characters only.
 */
function isValidVmId(id: string): boolean {
  return /^[a-f0-9]+$/i.test(id);
}

/**
 * Sanitizes a project name — prevents path traversal.
 * Returns null if the input is invalid.
 */
function sanitizeProject(project: string): string | null {
  if (!project || project.trim().length === 0) return null;
  if (project.includes('..') || project.includes('/') || project.includes('\\')) {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(project)) {
    return null;
  }
  return project;
}

/**
 * GET /api/vms/:id/logs/:project/search?q= — Search logs
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; project: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, project } = params;

  if (!id || !isValidVmId(id)) {
    return Response.json(
      { error: 'Invalid VM id format' },
      { status: 400 }
    );
  }

  const sanitizedProject = sanitizeProject(project);
  if (!sanitizedProject) {
    return Response.json(
      { error: 'Invalid project name' },
      { status: 400 }
    );
  }

  // Extract search query from URL params
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query || query.trim().length === 0) {
    return Response.json(
      { error: 'Search query parameter "q" is required' },
      { status: 400 }
    );
  }

  // Optional filename filter
  const filename = url.searchParams.get('file') || undefined;

  try {
    const logReader = getLogReader();
    const results = await logReader.searchLogs(id, sanitizedProject, query.trim(), filename);
    return Response.json(results);
  } catch (error) {
    return Response.json(
      { error: 'Failed to search logs' },
      { status: 500 }
    );
  }
}
