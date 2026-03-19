import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/main/session-manager';

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
  })),
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  it('creates a session and returns session info', () => {
    const info = manager.createSession({
      name: 'test-session',
      cwd: '/tmp',
      skipPermissions: false,
    });

    expect(info.id).toBeDefined();
    expect(info.name).toBe('test-session');
    expect(info.cwd).toBe('/tmp');
    expect(info.status).toBe('active');
  });

  it('lists all active sessions', () => {
    manager.createSession({ name: 's1', cwd: '/tmp', skipPermissions: false });
    manager.createSession({ name: 's2', cwd: '/tmp', skipPermissions: false });

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it('destroys a session by id', () => {
    const info = manager.createSession({ name: 'test', cwd: '/tmp', skipPermissions: false });
    manager.destroySession(info.id);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('spawns claude with --dangerously-skip-permissions when requested', async () => {
    const pty = await import('node-pty');
    manager.createSession({ name: 'skip', cwd: '/tmp', skipPermissions: true });

    const spawnCall = (pty.spawn as any).mock.calls[0];
    const args: string[] = spawnCall[1];
    expect(args).toContain('--dangerously-skip-permissions');
  });
});
