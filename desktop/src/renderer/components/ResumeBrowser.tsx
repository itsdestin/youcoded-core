import React, { useState, useEffect, useRef, useMemo } from 'react';

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

interface PastSession {
  sessionId: string;
  name: string;
  projectSlug: string;
  projectPath: string;
  lastModified: number;
  size: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onResume: (sessionId: string, projectSlug: string) => void;
}

export default function ResumeBrowser({ open, onClose, onResume }: Props) {
  const [sessions, setSessions] = useState<PastSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch sessions when opened
  useEffect(() => {
    if (open) {
      setSearch('');
      setLoading(true);
      (window as any).claude.session.browse()
        .then((list: PastSession[]) => setSessions(list))
        .catch(() => setSessions([]))
        .finally(() => setLoading(false));
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.projectPath.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  // Group by project path
  const grouped = useMemo(() => {
    if (search.trim()) return null;
    const groups = new Map<string, PastSession[]>();
    for (const s of filtered) {
      const list = groups.get(s.projectPath) || [];
      list.push(s);
      groups.set(s.projectPath, list);
    }
    return groups;
  }, [filtered, search]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-gray-950/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-800">
            <h2 className="text-sm font-bold text-gray-200 mb-3">Resume Session</h2>
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700/50">
              <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sessions..."
                className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
              />
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto py-2">
            {loading ? (
              <p className="text-sm text-gray-500 text-center py-8">Loading sessions...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                {search.trim() ? 'No matching sessions' : 'No previous sessions found'}
              </p>
            ) : grouped ? (
              // Grouped by project
              [...grouped.entries()].map(([projectPath, items]) => (
                <div key={projectPath} className="mb-2">
                  <div className="px-4 py-1">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">
                      {projectPath.replace(/\\/g, '/').split('/').pop() || projectPath}
                    </span>
                  </div>
                  {items.map((s) => (
                    <button
                      key={s.sessionId}
                      onClick={() => { onResume(s.sessionId, s.projectSlug); onClose(); }}
                      className="w-full text-left px-4 py-2 flex items-center gap-3 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{s.name}</div>
                        <div className="text-[10px] text-gray-600">{formatSize(s.size)}</div>
                      </div>
                      <span className="text-[10px] text-gray-600 shrink-0">
                        {formatRelativeTime(s.lastModified)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              // Flat search results
              filtered.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => { onResume(s.sessionId, s.projectSlug); onClose(); }}
                  className="w-full text-left px-4 py-2 flex items-center gap-3 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{s.name}</div>
                    <div className="text-[10px] text-gray-600">
                      {s.projectPath.replace(/\\/g, '/').split('/').pop()}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {formatRelativeTime(s.lastModified)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
