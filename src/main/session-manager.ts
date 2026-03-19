import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import { SessionInfo } from '../shared/types';
import { EventEmitter } from 'events';

interface CreateSessionOpts {
  name: string;
  cwd: string;
  skipPermissions: boolean;
}

interface ManagedSession {
  info: SessionInfo;
  pty: pty.IPty;
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>();

  createSession(opts: CreateSessionOpts): SessionInfo {
    const id = randomUUID();
    const args: string[] = [];
    if (opts.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    const claudePath = 'claude'; // assumes claude is in PATH

    const ptyProcess = pty.spawn(claudePath, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: opts.cwd,
      env: { ...process.env },
    });

    const info: SessionInfo = {
      id,
      name: opts.name,
      cwd: opts.cwd,
      permissionMode: opts.skipPermissions ? 'bypassPermissions' : 'default',
      skipPermissions: opts.skipPermissions,
      status: 'active',
      createdAt: Date.now(),
    };

    const session: ManagedSession = { info, pty: ptyProcess };
    this.sessions.set(id, session);

    ptyProcess.onData((data: string) => {
      this.emit('pty-output', id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('session-exit', id, exitCode);
      this.sessions.delete(id);
    });

    return info;
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.kill();
    this.sessions.delete(id);
    return true;
  }

  sendInput(id: string, text: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.write(text);
    return true;
  }

  resizeSession(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  getSession(id: string): SessionInfo | undefined {
    return this.sessions.get(id)?.info;
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }
}
