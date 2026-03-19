import React, { useState, useEffect, useRef } from 'react';
import TerminalView from './components/TerminalView';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const sessionCounter = useRef(0);

  useEffect(() => {
    window.claude.on.sessionCreated((info) => {
      setSessions((prev) => [...prev, info]);
      setSessionId(info.id);
    });

    window.claude.on.sessionDestroyed((id) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setSessionId((curr) => (curr === id ? null : curr));
    });

    // Log hook events to console for now (Phase 2 will render them)
    window.claude.on.hookEvent((event) => {
      console.log('[Hook Event]', event.type, event);
    });

    return () => {
      window.claude.removeAllListeners('session:created');
      window.claude.removeAllListeners('session:destroyed');
      window.claude.removeAllListeners('hook:event');
    };
  }, []);

  const createSession = async () => {
    sessionCounter.current += 1;
    await window.claude.session.create({
      name: 'session-' + sessionCounter.current,
      cwd: 'C:\\Users\\desti',
      skipPermissions: false,
    });
  };

  return (
    <div className="h-screen bg-gray-950 text-gray-200 flex">
      {/* Sidebar */}
      <div className="w-14 bg-gray-900 flex flex-col items-center py-3 gap-3 border-r border-gray-800">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => setSessionId(s.id)}
            className={
              'w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ' +
              (sessionId === s.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700')
            }
            title={s.name}
          >
            {s.name.charAt(0).toUpperCase()}
          </button>
        ))}
        <button
          onClick={createSession}
          className="w-10 h-10 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 flex items-center justify-center text-xl"
          title="New Session"
        >
          +
        </button>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col p-2">
        {sessionId ? (
          <>
            <div className="h-10 flex items-center px-3 text-sm text-gray-400 border-b border-gray-800 mb-2">
              {sessions.find((s) => s.id === sessionId)?.name || 'Session'}
            </div>
            <TerminalView key={sessionId} sessionId={sessionId} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Click + to start a new Claude session
          </div>
        )}
      </div>
    </div>
  );
}
