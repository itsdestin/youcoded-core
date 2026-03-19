import { useEffect, useRef } from 'react';

// Type declaration for the preload API
declare global {
  interface Window {
    claude: {
      session: {
        create: (opts: { name: string; cwd: string; skipPermissions: boolean }) => Promise<any>;
        destroy: (sessionId: string) => Promise<boolean>;
        list: () => Promise<any[]>;
        sendInput: (sessionId: string, text: string) => void;
      };
      on: {
        sessionCreated: (cb: (info: any) => void) => void;
        sessionDestroyed: (cb: (id: string) => void) => void;
        ptyOutput: (cb: (sessionId: string, data: string) => void) => void;
        hookEvent: (cb: (event: any) => void) => void;
      };
      removeAllListeners: (channel: string) => void;
    };
  }
}

export function usePtyOutput(
  sessionId: string | null,
  onData: (data: string) => void,
) {
  const cbRef = useRef(onData);
  cbRef.current = onData;

  useEffect(() => {
    if (!sessionId) return;

    window.claude.on.ptyOutput((sid, data) => {
      if (sid === sessionId) {
        cbRef.current(data);
      }
    });

    return () => {
      window.claude.removeAllListeners('pty:output');
    };
  }, [sessionId]);
}
