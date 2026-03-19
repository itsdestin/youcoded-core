import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

contextBridge.exposeInMainWorld('claude', {
  session: {
    create: (opts: { name: string; cwd: string; skipPermissions: boolean }) =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, opts),
    destroy: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_DESTROY, sessionId),
    list: () => ipcRenderer.invoke(IPC.SESSION_LIST),
    sendInput: (sessionId: string, text: string) =>
      ipcRenderer.send(IPC.SESSION_INPUT, sessionId, text),
  },
  on: {
    sessionCreated: (cb: (info: any) => void) =>
      ipcRenderer.on(IPC.SESSION_CREATED, (_e, info) => cb(info)),
    sessionDestroyed: (cb: (id: string) => void) =>
      ipcRenderer.on(IPC.SESSION_DESTROYED, (_e, id) => cb(id)),
    ptyOutput: (cb: (sessionId: string, data: string) => void) =>
      ipcRenderer.on(IPC.PTY_OUTPUT, (_e, sid, data) => cb(sid, data)),
    hookEvent: (cb: (event: any) => void) =>
      ipcRenderer.on(IPC.HOOK_EVENT, (_e, event) => cb(event)),
  },
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
});
