import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto/credential-store';

/**
 * PUT /api/vms/:id — Update a VM
 */
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id || !/^[a-f0-9]+$/i.test(id)) {
    return Response.json({ error: 'Invalid VM id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getDb();

  // Check VM exists
  const existing = db.prepare('SELECT id FROM vms WHERE id = ?').get(id);
  if (!existing) {
    return Response.json({ error: 'VM not found' }, { status: 404 });
  }

  const { label, host, port, username, password } = body;

  // Validate
  if (label !== undefined && (typeof label !== 'string' || label.trim().length === 0)) {
    return Response.json({ error: 'label must be a non-empty string' }, { status: 400 });
  }
  if (host !== undefined && (typeof host !== 'string' || host.trim().length === 0)) {
    return Response.json({ error: 'host must be a non-empty string' }, { status: 400 });
  }
  if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) {
    return Response.json({ error: 'port must be 1-65535' }, { status: 400 });
  }
  if (username !== undefined && (typeof username !== 'string' || username.trim().length === 0)) {
    return Response.json({ error: 'username must be a non-empty string' }, { status: 400 });
  }

  try {
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (label !== undefined) {
      updates.push('label = ?');
      values.push(label.trim());
    }
    if (host !== undefined) {
      updates.push('host = ?');
      values.push(host.trim());
    }
    if (port !== undefined) {
      updates.push('port = ?');
      values.push(port);
    }
    if (username !== undefined) {
      updates.push('username = ?');
      values.push(username.trim());
    }
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const encrypted = encrypt(password.trim());
      updates.push('encrypted_password = ?, encryption_iv = ?, encryption_auth_tag = ?');
      values.push(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
    }

    if (updates.length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    db.prepare(`UPDATE vms SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Return updated VM
    const updated = db.prepare('SELECT id, label, host, port, username, created_at, updated_at FROM vms WHERE id = ?').get(id);
    return Response.json(updated);
  } catch {
    return Response.json({ error: 'Failed to update VM' }, { status: 500 });
  }
}

/**
 * DELETE /api/vms/:id — Delete a VM
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id || !/^[a-f0-9]+$/i.test(id)) {
    return Response.json({ error: 'Invalid VM id' }, { status: 400 });
  }

  const db = getDb();

  // Check VM exists
  const existing = db.prepare('SELECT id, label FROM vms WHERE id = ?').get(id) as { id: string; label: string } | undefined;
  if (!existing) {
    return Response.json({ error: 'VM not found' }, { status: 404 });
  }

  try {
    // Delete VM (vm_status will cascade due to ON DELETE CASCADE)
    db.prepare('DELETE FROM vms WHERE id = ?').run(id);

    return Response.json({ success: true, deleted: existing.label });
  } catch {
    return Response.json({ error: 'Failed to delete VM' }, { status: 500 });
  }
}
