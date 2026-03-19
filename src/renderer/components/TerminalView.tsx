import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePtyOutput } from '../hooks/useIpc';

interface Props {
  sessionId: string | null;
}

export default function TerminalView({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Send user keyboard input to PTY
    terminal.onData((data) => {
      if (sessionId) {
        window.claude.session.sendInput(sessionId, data);
      }
    });

    // Resize handler
    const onResize = () => fitAddon.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      terminal.dispose();
    };
  }, []);

  // Write PTY output to terminal
  usePtyOutput(sessionId, (data) => {
    terminalRef.current?.write(data);
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-[#0d1117] rounded-lg overflow-hidden"
    />
  );
}
