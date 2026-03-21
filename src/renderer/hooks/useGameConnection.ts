import { useEffect, useRef, useCallback } from 'react';
import { useGameDispatch } from '../state/game-context';

const RELAY_URL = 'ws://localhost:3002'; // TODO: make configurable

export function useGameConnection() {
  const dispatch = useGameDispatch();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(RELAY_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch({ type: 'CONNECTION_STATUS', connected: true });

      // Auto-authenticate if we have credentials
      const username = localStorage.getItem('c4_username');
      const password = localStorage.getItem('c4_password');
      if (username && password) {
        ws.send(JSON.stringify({ type: 'authenticate', username, password }));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'authenticated':
          dispatch({ type: 'AUTHENTICATED', success: msg.success });
          if (msg.success) {
            const username = localStorage.getItem('c4_username');
            if (username) dispatch({ type: 'SET_USERNAME', username });
          }
          break;
        case 'presence':
          dispatch({ type: 'PRESENCE_UPDATE', online: msg.online });
          break;
        case 'room:created':
          dispatch({ type: 'ROOM_CREATED', code: msg.code, color: msg.color });
          break;
        case 'game:start':
          dispatch({ type: 'GAME_START', board: msg.board, you: msg.you, opponent: msg.opponent });
          break;
        case 'game:state':
          dispatch({ type: 'GAME_STATE', board: msg.board, turn: msg.turn, lastMove: msg.lastMove });
          break;
        case 'game:over':
          dispatch({ type: 'GAME_OVER', winner: msg.winner, line: msg.line });
          break;
        case 'chat:message':
          dispatch({ type: 'CHAT_MESSAGE', from: msg.from, text: msg.text });
          break;
        case 'opponent:disconnected':
          dispatch({ type: 'OPPONENT_DISCONNECTED' });
          break;
      }
    };

    ws.onclose = () => {
      dispatch({ type: 'CONNECTION_STATUS', connected: false });
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [dispatch]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Send helpers
  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const authenticate = useCallback((username: string, password: string) => {
    localStorage.setItem('c4_username', username);
    localStorage.setItem('c4_password', password);
    sendMessage({ type: 'authenticate', username, password });
  }, [sendMessage]);

  const register = useCallback(async (username: string, password: string): Promise<boolean> => {
    const res = await fetch('http://localhost:3001/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 201) {
      authenticate(username, password);
      return true;
    }
    return false;
  }, [authenticate]);

  const createGame = useCallback(() => sendMessage({ type: 'create' }), [sendMessage]);
  const joinGame = useCallback((code: string) => sendMessage({ type: 'join', code }), [sendMessage]);
  const makeMove = useCallback((column: number) => sendMessage({ type: 'move', column }), [sendMessage]);
  const sendChat = useCallback((text: string) => sendMessage({ type: 'chat', text }), [sendMessage]);
  const requestRematch = useCallback(() => sendMessage({ type: 'rematch' }), [sendMessage]);

  return { register, authenticate, createGame, joinGame, makeMove, sendChat, requestRematch };
}
