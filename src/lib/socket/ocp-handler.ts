import type { AuthenticatedSocket } from './socket-server';
import { openPodExecSession, type PodExecSession } from '../openshift';

export interface OcpExecOpenPayload {
  clusterId?: string;
  namespace: string;
  podName: string;
  container?: string;
  shell?: '/bin/sh' | '/bin/bash';
  cols?: number;
  rows?: number;
}

const activeExecSessions = new Map<string, PodExecSession>();

function cleanupExecSession(socketId: string): void {
  const session = activeExecSessions.get(socketId);
  if (session) {
    try {
      session.close();
    } catch {
      // Ignore cleanup errors
    }
    activeExecSessions.delete(socketId);
  }
}

/**
 * Registers Socket.IO event handlers for interactive OpenShift Pod Exec.
 */
export function registerOcpHandlers(socket: AuthenticatedSocket): void {
  socket.on('ocp:exec:open', async (payload: OcpExecOpenPayload) => {
    cleanupExecSession(socket.id);

    if (!payload?.namespace || !payload?.podName) {
      socket.emit('ocp:exec:error', 'namespace dan podName diperlukan.');
      return;
    }

    try {
      const session = await openPodExecSession(
        socket.data.userId,
        payload.clusterId,
        payload.namespace,
        payload.podName,
        payload.container,
        payload.shell === '/bin/bash' ? '/bin/bash' : '/bin/sh',
        payload.cols || 80,
        payload.rows || 24,
        {
          onOpen: () => {
            socket.emit('ocp:exec:ready');
          },
          onData: (data: string) => {
            socket.emit('ocp:exec:output', data);
          },
          onError: (message: string) => {
            socket.emit('ocp:exec:error', message);
          },
          onClose: () => {
            activeExecSessions.delete(socket.id);
            socket.emit('ocp:exec:close');
          },
        },
      );

      if (!socket.connected) {
        session.close();
        return;
      }

      activeExecSessions.set(socket.id, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuka pod exec session.';
      socket.emit('ocp:exec:error', msg);
    }
  });

  socket.on('ocp:exec:input', (data: string) => {
    const session = activeExecSessions.get(socket.id);
    if (session && typeof data === 'string') {
      session.write(data);
    }
  });

  socket.on('ocp:exec:resize', (cols: number, rows: number) => {
    const session = activeExecSessions.get(socket.id);
    if (session) {
      session.resize(cols, rows);
    }
  });

  socket.on('ocp:exec:close', () => {
    cleanupExecSession(socket.id);
    socket.emit('ocp:exec:close');
  });

  socket.on('disconnect', () => {
    cleanupExecSession(socket.id);
  });
}
