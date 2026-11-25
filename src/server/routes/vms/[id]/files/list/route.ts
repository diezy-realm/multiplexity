import { getServerSession } from '@/server/auth/session';
import { getSSHManager } from '@/lib/ssh/ssh-manager';
import { handleSSHError } from '@/lib/ssh/ssh-error-handler';
import { getCredential } from '@/lib/crypto/credential-store';
import { isConfigFile, isCodeFile } from '@/lib/services/file-types';

function isValidVmId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id || !isValidVmId(id)) {
    return Response.json({ error: 'Invalid VM id format' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const dir = searchParams.get('dir');
  const recursive = searchParams.get('recursive') === 'true';
  const search = searchParams.get('search') || '';

  if (!dir || typeof dir !== 'string') {
    return Response.json({ error: 'dir parameter is required' }, { status: 400 });
  }

  try {
    const sshManager = getSSHManager();

    let password = '';
    try {
      password = await getCredential(id);
    } catch {
      // ignore
    }
    const b64Pass = password ? Buffer.from(password, 'utf-8').toString('base64') : '';

    const sudoWrap = (c: string) => {
      if (b64Pass) {
        return `(echo "${b64Pass}" | base64 -d | sudo -S -p '' ${c}) || (sudo ${c}) || (${c})`;
      }
      return `(sudo ${c}) || (${c})`;
    };

    const cleanDir = dir.endsWith('/') ? dir : `${dir}/`;

    // Recursive search across subfolders (e.g. for .go files or query)
    if (recursive || search) {
      const safeSearch = search.replace(/["';`$\\]/g, '').trim();
      const pattern = safeSearch ? `*${safeSearch}*` : '*';
      const findCmd = `${sudoWrap(
        `find "${dir}" -maxdepth 4 -not -path '*/.*' -not -path '*/vendor/*' -not -path '*/node_modules/*' -name "${pattern}" -type f 2>/dev/null`
      )} | head -n 250`;

      const output = await sshManager.executeCommand(id, findCmd);
      const rawLines = output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.includes('/.git/') && !l.includes('/node_modules/') && !l.includes('/vendor/'));

      const files = rawLines.map((fullPath) => {
        const relativePath = fullPath.startsWith(cleanDir) ? fullPath.slice(cleanDir.length) : fullPath;
        const filename = fullPath.split('/').pop() || fullPath;
        return {
          name: relativePath,
          filename,
          path: fullPath,
          isDir: false,
          isConfig: isConfigFile(filename),
          isCode: isCodeFile(filename),
        };
      }).sort((a, b) => {
        if (a.isConfig && !b.isConfig) return -1;
        if (!a.isConfig && b.isConfig) return 1;
        if (a.isCode && !b.isCode) return -1;
        if (!a.isCode && b.isCode) return 1;
        return a.name.localeCompare(b.name);
      });

      return Response.json({
        dir,
        files,
        isRecursive: true,
        timestamp: new Date().toISOString(),
      });
    }

    // List files and directories in target path (exclude . and ..)
    const listCmd = `(cd "${dir}" 2>/dev/null && ls -1ap 2>/dev/null) || (${sudoWrap(`ls -1ap "${dir}" 2>/dev/null`)}) | grep -v '^\\./$' | grep -v '^\\.\\./$' | head -n 250`;
    const output = await sshManager.executeCommand(id, listCmd);

    const rawEntries = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== './' && l !== '../');

    const files = rawEntries
      .filter((name) => {
        // Filter out noisy heavy directories
        return name !== '.git/' && name !== 'node_modules/' && name !== 'vendor/';
      })
      .map((name) => {
        const isDir = name.endsWith('/');
        const cleanName = isDir ? name.slice(0, -1) : name;
        return {
          name: cleanName,
          filename: cleanName,
          path: `${cleanDir}${cleanName}`,
          isDir,
          isConfig: !isDir && isConfigFile(cleanName),
          isCode: !isDir && isCodeFile(cleanName),
        };
      })
      // Sort: config files first, then directories, then other files
      .sort((a, b) => {
        if (a.isConfig && !b.isConfig) return -1;
        if (!a.isConfig && b.isConfig) return 1;
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        if (a.isCode && !b.isCode) return -1;
        if (!a.isCode && b.isCode) return 1;
        return a.name.localeCompare(b.name);
      });

    return Response.json({
      dir,
      files,
      isRecursive: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const sshError = handleSSHError(err);
    return Response.json(
      { error: sshError.message || `Failed to list files in ${dir}`, details: err.message },
      { status: 500 }
    );
  }
}
