import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { authenticateSocket } from '@/server/auth/session';
import { registerTerminalHandlers } from './terminal-handler';
import { registerLogHandlers } from './log-handler';
import { registerOcpHandlers, type OcpExecOpenPayload } from './ocp-handler';

/**
 * Socket.IO event interfaces for type-safe communication.
 */
export interface ServerToClientEvents {
  'terminal:output': (data: string) => void;
  'terminal:error': (error: string) => void;
  'terminal:close': () => void;
  'terminal:log-files': (result: { directory: string; entries: { name: string; isDir: boolean; path: string }[] }) => void;
  'terminal:git-info': (result: { isGit: boolean; branch: string | null; directory: string }) => void;
  'log:newEntry': (entry: LogEntry) => void;
  'vm:statusChange': (status: VMStatus) => void;
  'ocp:exec:ready': () => void;
  'ocp:exec:output': (data: string) => void;
  'ocp:exec:error': (error: string) => void;
  'ocp:exec:close': () => void;
}

export interface ClientToServerEvents {
  'terminal:open': (vmId: string, initialSize?: { cols: number; rows: number }) => void;
  'terminal:list-logs': (vmId: string, directory?: string) => void;
  'terminal:check-git': (vmId: string, directory?: string) => void;
  'terminal:input': (data: string) => void;
  'terminal:resize': (cols: number, rows: number) => void;
  'terminal:close': () => void;
  'log:subscribe': (vmId: string, project: string, filename: string) => void;
  'log:unsubscribe': () => void;
  'ocp:exec:open': (payload: OcpExecOpenPayload) => void;
  'ocp:exec:input': (data: string) => void;
  'ocp:exec:resize': (cols: number, rows: number) => void;
  'ocp:exec:close': () => void;
}

export interface LogEntry {
  level: 'ERROR' | 'DEBUG' | 'INFO' | 'ALL';
  timestamp: string;
  message: string;
  raw: string;
}

export interface VMStatus {
  vmId: string;
  status: 'online' | 'offline' | 'unreachable';
  lastChecked: Date;
  failCount: number;
}

/**
 * Extended socket interface with authenticated user data.
 */
export interface AuthenticatedSocket extends Socket<ClientToServerEvents, ServerToClientEvents> {
  data: {
    userId: string;
    username: string;
  };
}

/**
 * Typed Socket.IO server instance.
 */
export type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Singleton Socket.IO server instance.
 */
let io: IOServer | null = null;
const sharedServer = globalThis as typeof globalThis & { managerSocketServer?: IOServer };

/**
 * Returns the Socket.IO server instance.
 * Throws if the server has not been initialized yet.
 */
export function getIO(): IOServer {
  const server = io || sharedServer.managerSocketServer;
  if (!server) {
    throw new Error('Socket.IO server has not been initialized. Call initSocketServer() first.');
  }
  return server;
}

/**
 * Initializes the Socket.IO server and attaches it to the given HTTP server.
 * Sets up authentication middleware to validate shared encrypted sessions.
 */
export function initSocketServer(httpServer: HTTPServer): IOServer {
  if (io) {
    return io;
  }

  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: '/api/socketio',
    addTrailingSlash: false,
    serveClient: false,
    allowUpgrades: true,
    transports: ['websocket', 'polling'],
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  io.use(authenticateSocket);

  // Log connections and register event handlers
  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    console.log(
      `[Socket.IO] Client connected: ${authSocket.id} (user: ${authSocket.data.username})`
    );

    // Register terminal event handlers
    registerTerminalHandlers(authSocket);

    // Register log streaming event handlers
    registerLogHandlers(authSocket);

    // Register OpenShift Pod Exec handlers
    registerOcpHandlers(authSocket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket.IO] Client disconnected: ${authSocket.id} (reason: ${reason})`
      );
    });
  });

  console.log('[Socket.IO] Server initialized');
  sharedServer.managerSocketServer = io;
  return io;
}

/**
 * Resets the Socket.IO server instance (useful for testing).
 */
export function resetSocketServer(): void {
  if (io) {
    io.close();
    io = null;
    delete sharedServer.managerSocketServer;
  }
}

/**
 * Creates a Socket.IO server in "noServer" mode for use with custom upgrade handling.
 * The production listener attaches its own transport and origin policy.
 */
export function setupSocketIO(): IOServer {
  if (io) {
    return io;
  }

  io = new Server<ClientToServerEvents, ServerToClientEvents>({
    path: '/api/socketio',
    addTrailingSlash: false,
    serveClient: false,
    allowUpgrades: true,
    transports: ['websocket', 'polling'],
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  io.use(authenticateSocket);

  // Log connections and register event handlers
  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    console.log(
      `[Socket.IO] Client connected: ${authSocket.id} (user: ${authSocket.data.username})`
    );

    registerTerminalHandlers(authSocket);
    registerLogHandlers(authSocket);
    registerOcpHandlers(authSocket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket.IO] Client disconnected: ${authSocket.id} (reason: ${reason})`
      );
    });
  });

  console.log('[Socket.IO] Server initialized (noServer mode)');
  sharedServer.managerSocketServer = io;
  return io;
}
