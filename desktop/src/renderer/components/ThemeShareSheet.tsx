import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../state/theme-context';
import type { LoadedTheme } from '../themes/theme-types';

interface ThemeShareSheetProps {
  themeSlug: string;
  onClose: () => void;
}

export default function ThemeShareSheet({ themeSlug, onClose }: ThemeShareSheetProps) {
  const { allThemes } = useTheme();
  const theme = allThemes.find(t => t.slug === themeSlug);

  const [publishing, setPublishing] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const claude = (window as any).claude;
      const result = await claude.theme.marketplace.publish(themeSlug);
      setPrUrl(result.prUrl);
    } catch (err: any) {
      setPublishError(err?.message || 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  }, [themeSlug]);

  if (!theme) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-panel border border-edge-dim rounded-xl p-5 max-w-sm w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-fg">
            Publish: {theme.name}
          </h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none">
            &times;
          </button>
        </div>

        {/* Theme preview card */}
        <div className="rounded-lg overflow-hidden border border-edge-dim mb-4">
          <div style={{ height: 6, background: `linear-gradient(90deg, ${theme.tokens.canvas}, ${theme.tokens.accent})` }} />
          <div className="px-3 py-2.5" style={{ background: theme.tokens.canvas }}>
            <p className="text-xs font-medium" style={{ color: theme.tokens.fg }}>{theme.name}</p>
            <p className="text-[10px] mt-0.5" style={{ color: theme.tokens['fg-muted'] }}>
              {theme.dark ? 'Dark' : 'Light'} theme
              {theme.effects?.particles && theme.effects.particles !== 'none' ? ` \u00b7 ${theme.effects.particles} particles` : ''}
              {theme.font?.family ? ` \u00b7 ${theme.font.family.split(',')[0].replace(/'/g, '')}` : ''}
            </p>
          </div>
        </div>

        {/* Info */}
        <p className="text-[11px] text-fg-muted mb-4 leading-relaxed">
          This will create a pull request to the{' '}
          <span className="text-fg-2 font-medium">destinclaude-themes</span>{' '}
          repository on GitHub. Your theme will be reviewed and, if approved, added to the marketplace for all users.
        </p>

        <p className="text-[10px] text-fg-faint mb-4">
          Requires the <span className="font-mono">gh</span> CLI to be installed and authenticated.
        </p>

        {/* Publish section */}
        <div className="border-t border-edge-dim pt-4">
          {prUrl ? (
            <div className="text-center">
              <p className="text-xs text-[#4CAF50] font-medium mb-1">Published successfully!</p>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline break-all"
                onClick={(e) => {
                  e.preventDefault();
                  (window as any).claude?.shell?.openExternal?.(prUrl);
                }}
              >
                {prUrl}
              </a>
            </div>
          ) : (
            <>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="w-full text-xs font-medium py-2.5 rounded-lg bg-accent text-on-accent hover:brightness-110 transition-colors disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish to Marketplace'}
              </button>
              {publishError && (
                <p className="text-xs text-red-400 text-center mt-2">{publishError}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
