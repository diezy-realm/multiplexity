'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, type Socket } from 'socket.io-client';
import { RotateCw, Terminal } from 'lucide-react';
import Dialog from '@/components/Dialog';
import Select from '@/components/Select';
import '@xterm/xterm/css/xterm.css';

interface OpenshiftTerminalModalProps {
  clusterId?: string;
  project: string;
  pod: string;
  containers: string[];
  onClose: () => void;
}

export default function OpenshiftTerminalModal({
  clusterId,
  project,
  pod,
  containers,
  onClose,
}: OpenshiftTerminalModalProps) {
  const [container, setContainer] = useState(containers[0] || '');
  const [shell, setShell] = useState<'/bin/sh' | '/bin/bash'>('/bin/sh');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [reconnectSeq, setReconnectSeq] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fitAndResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return;
    try {
      fitAddonRef.current.fit();
      if (socketRef.current?.connected) {
        socketRef.current.emit('ocp:exec:resize', xtermRef.current.cols, xtermRef.current.rows);
      }
    } catch {
      // Ignore fit errors while resizing
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    setStatus('connecting');
    setErrorMsg('');

    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#090d16',
        foreground: '#e5e7eb',
        cursor: '#60a5fa',
      },
      fontSize: 13,
      fontFamily: 'var(--font-geist-mono), Consolas, monospace',
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // ignore initial fit
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io({
      path: '/api/socketio',
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    const inputDispose = term.onData(data => {
      if (socket.connected) {
        socket.emit('ocp:exec:input', data);
      }
    });

    socket.on('connect', () => {
      setStatus('connecting');
      let cols = 80;
      let rows = 24;
      try {
        fitAddon.fit();
        cols = term.cols || 80;
        rows = term.rows || 24;
      } catch {
        // use defaults
      }

      socket.emit('ocp:exec:open', {
        clusterId,
        namespace: project,
        podName: pod,
        container: container || undefined,
        shell,
        cols,
        rows,
      });
    });

    socket.on('ocp:exec:ready', () => {
      setStatus('connected');
      fitAndResize();
      term.focus();
    });

    socket.on('ocp:exec:output', (data: string) => {
      term.write(data);
    });

    socket.on('ocp:exec:error', (msg: string) => {
      setStatus('error');
      setErrorMsg(msg);
      term.writeln(`\r\n\x1b[31m[Error] ${msg}\x1b[0m`);
    });

    socket.on('ocp:exec:close', () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[33m[Session closed]\x1b[0m');
    });

    socket.on('connect_error', err => {
      setStatus('error');
      setErrorMsg(err.message);
    });

    const onResize = () => fitAndResize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      inputDispose.dispose();
      if (socket.connected) {
        socket.emit('ocp:exec:close');
      }
      socket.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      socketRef.current = null;
    };
  }, [clusterId, project, pod, container, shell, reconnectSeq, fitAndResize]);

  const statusBadge = {
    connecting: { label: 'Menghubungkan…', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    connected: { label: 'Terhubung', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    disconnected: { label: 'Terputus', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
    error: { label: 'Error', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  }[status];

  return (
    <Dialog title={`Exec Terminal — ${pod}`} onClose={onClose} className="max-w-5xl">
      <div className="flex flex-col h-[72dvh] min-h-0 -mt-2 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0">
              <Terminal aria-hidden="true" size={16} />
            </span>
            <span className="font-mono text-xs text-gray-400 truncate">
              oc rsh -n {project} {pod}
            </span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {containers.length > 1 && (
              <Select
                aria-label="Container"
                value={container}
                onChange={e => setContainer(e.target.value)}
                className="ui-field text-xs py-1 px-2.5"
              >
                {containers.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}

            <Select
              aria-label="Shell"
              value={shell}
              onChange={e => setShell(e.target.value as '/bin/sh' | '/bin/bash')}
              className="ui-field text-xs py-1 px-2.5"
            >
              <option value="/bin/sh">/bin/sh</option>
              <option value="/bin/bash">/bin/bash</option>
            </Select>

            <button
              type="button"
              onClick={() => setReconnectSeq(s => s + 1)}
              className="ui-button"
              title="Reconnect terminal"
            >
              <RotateCw aria-hidden="true" size={13} />
              Reconnect
            </button>
          </div>
        </div>

        {errorMsg && (
          <p role="alert" className="text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        <div
          ref={containerRef}
          className="flex-1 min-h-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-[#090d16] p-2 overflow-hidden"
        />
      </div>
    </Dialog>
  );
}
