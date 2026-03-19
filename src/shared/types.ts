export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  permissionMode: string;
  skipPermissions: boolean;
  status: 'active' | 'idle' | 'destroyed';
  createdAt: number;
}

export interface HookEvent {
  type: string;
  sessionId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

// IPC channel names
export const IPC = {
  // Renderer -> Main
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_INPUT: 'session:input',
  SESSION_LIST: 'session:list',
  // Main -> Renderer
  SESSION_CREATED: 'session:created',
  SESSION_DESTROYED: 'session:destroyed',
  PTY_OUTPUT: 'pty:output',
  HOOK_EVENT: 'hook:event',
} as const;
