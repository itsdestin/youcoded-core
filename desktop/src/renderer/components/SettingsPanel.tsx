import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface RemoteConfig {
  enabled: boolean;
  port: number;
  hasPassword: boolean;
  trustTailscale: boolean;
  clientCount: number;
}

interface TailscaleInfo {
  installed: boolean;
  ip: string | null;
  hostname: string | null;
  url: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSendInput: (text: string) => void;
  hasActiveSession: boolean;
}

export default function SettingsPanel({ open, onClose, onSendInput, hasActiveSession }: Props) {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [tailscale, setTailscale] = useState<TailscaleInfo | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loading, setLoading] = useState(true);

  // Load config and detect Tailscale on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const claude = (window as any).claude;
    if (!claude?.remote) { setLoading(false); return; }
    Promise.all([
      claude.remote.getConfig(),
      claude.remote.detectTailscale(),
    ]).then(([cfg, ts]: [RemoteConfig, TailscaleInfo]) => {
      setConfig(cfg);
      setTailscale(ts);
      setLoading(false);
    }).catch(() => setLoading(false));
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

  const handleSetPassword = useCallback(async () => {
    if (!newPassword.trim()) return;
    setPasswordStatus('saving');
    try {
      await (window as any).claude.remote.setPassword(newPassword);
      setConfig(prev => prev ? { ...prev, hasPassword: true } : prev);
      setNewPassword('');
      setPasswordStatus('saved');
      setTimeout(() => setPasswordStatus('idle'), 2000);
    } catch {
      setPasswordStatus('idle');
    }
  }, [newPassword]);

  const handleToggleEnabled = useCallback(async () => {
    if (!config) return;
    const updated = await (window as any).claude.remote.setConfig({ enabled: !config.enabled });
    setConfig(prev => prev ? { ...prev, ...updated } : prev);
  }, [config]);

  const handleToggleTailscaleTrust = useCallback(async () => {
    if (!config) return;
    const updated = await (window as any).claude.remote.setConfig({ trustTailscale: !config.trustTailscale });
    setConfig(prev => prev ? { ...prev, ...updated } : prev);
  }, [config]);

  const handleRunSetup = useCallback(() => {
    if (!hasActiveSession) return;
    onSendInput('/remote-setup');
    onClose();
  }, [hasActiveSession, onSendInput, onClose]);

  const isSetUp = config?.hasPassword && tailscale?.installed;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-gray-900 border-r border-gray-700/50 z-50 transform transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-bold text-gray-200">Settings</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              ✕
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              Loading...
            </div>
          ) : (
            <div className="flex-1 px-4 py-4 space-y-6">
              {/* Setup prompt — shown when not fully configured */}
              {!isSetUp && (
                <div className="bg-blue-500/10 border border-blue-500/25 rounded-lg p-3">
                  <p className="text-xs text-blue-400 mb-2">
                    Remote access lets you use DestinCode from any device — phone, tablet, or another computer.
                  </p>
                  <button
                    onClick={handleRunSetup}
                    disabled={!hasActiveSession}
                    className="w-full px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!hasActiveSession ? 'Create a session first' : ''}
                  >
                    Set Up Remote Access
                  </button>
                  {!hasActiveSession && (
                    <p className="text-[10px] text-gray-500 mt-1 text-center">Create a session first to run setup</p>
                  )}
                </div>
              )}

              {/* Remote Access section */}
              <section>
                <h3 className="text-[10px] font-medium text-gray-500 tracking-wider uppercase mb-3">Remote Access</h3>

                {/* Enable/disable toggle */}
                <label className="flex items-center justify-between py-2 cursor-pointer">
                  <span className="text-xs text-gray-300">Enabled</span>
                  <button
                    onClick={handleToggleEnabled}
                    className={`w-8 h-4 rounded-full transition-colors relative ${
                      config?.enabled ? 'bg-green-600' : 'bg-gray-700'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      config?.enabled ? 'left-4' : 'left-0.5'
                    }`} />
                  </button>
                </label>

                {/* Password */}
                <div className="py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-300">Password</span>
                    {config?.hasPassword && (
                      <span className="text-[10px] text-green-400">Set</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      placeholder={config?.hasPassword ? 'Change password...' : 'Set password...'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                      className="flex-1 px-2 py-1 rounded bg-[#1C1C1C] border border-gray-700/50 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
                    />
                    <button
                      onClick={handleSetPassword}
                      disabled={!newPassword.trim() || passwordStatus === 'saving'}
                      className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs disabled:opacity-50"
                    >
                      {passwordStatus === 'saved' ? '✓' : passwordStatus === 'saving' ? '...' : 'Set'}
                    </button>
                  </div>
                </div>

                {/* Connected clients */}
                {config && config.clientCount > 0 && (
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300">Remote clients</span>
                    <span className="text-xs text-gray-400">{config.clientCount} connected</span>
                  </div>
                )}
              </section>

              {/* Tailscale section */}
              <section>
                <h3 className="text-[10px] font-medium text-gray-500 tracking-wider uppercase mb-3">Tailscale</h3>

                {tailscale?.installed ? (
                  <>
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-xs text-gray-300">Status</span>
                      <span className="text-[10px] text-green-400">
                        Connected{tailscale.hostname ? ` · ${tailscale.hostname}` : ''}
                      </span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-xs text-gray-300">IP</span>
                      <span className="text-xs text-gray-400 font-mono">{tailscale.ip}</span>
                    </div>

                    <label className="flex items-center justify-between py-2 cursor-pointer">
                      <span className="text-xs text-gray-300">Skip password on Tailscale</span>
                      <button
                        onClick={handleToggleTailscaleTrust}
                        className={`w-8 h-4 rounded-full transition-colors relative ${
                          config?.trustTailscale ? 'bg-green-600' : 'bg-gray-700'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          config?.trustTailscale ? 'left-4' : 'left-0.5'
                        }`} />
                      </button>
                    </label>

                    {tailscale.url && config?.hasPassword && (
                      <div className="py-3">
                        <p className="text-[10px] text-gray-500 mb-2">Scan to open on your phone:</p>
                        <div className="flex justify-center bg-white rounded-lg p-3 w-fit mx-auto">
                          <QRCodeSVG value={tailscale.url} size={160} />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-2 text-center font-mono">{tailscale.url}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-2">
                    <p className="text-xs text-gray-500 mb-2">
                      Tailscale is not installed. It creates a secure private network so you can access DestinCode from anywhere.
                    </p>
                    <button
                      onClick={handleRunSetup}
                      disabled={!hasActiveSession}
                      className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs disabled:opacity-50"
                    >
                      Install with Setup Skill
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
