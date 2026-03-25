import { GameState, GameAction, createInitialGameState } from './game-types';

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'GITHUB_READY':
      return { ...state, connected: true, username: action.username, screen: 'lobby', githubError: null };

    case 'GITHUB_ERROR':
      return { ...state, connected: false, githubError: action.message };

    case 'CONNECTION_STATUS':
      return { ...state, connected: action.connected };

    case 'PRESENCE_UPDATE':
      return { ...state, onlineUsers: action.online };

    case 'ROOM_CREATED':
      return {
        ...state,
        roomCode: action.code,
        myColor: action.color,
        screen: 'waiting',
      };

    case 'GAME_START':
      return {
        ...state,
        board: action.board,
        myColor: action.you,
        opponent: action.opponent,
        turn: 'red',
        screen: 'playing',
        winner: null,
        winLine: null,
        chatMessages: [],
        lastMove: null,
        actionCount: action.actionCount,
        movePending: false,
      };

    case 'GAME_STATE': {
      // Reject stale poll data — only apply if remote has more actions than we know about
      if (action.actionCount <= state.actionCount) return state;
      const next: GameState = {
        ...state,
        board: action.board,
        turn: action.turn,
        lastMove: action.lastMove,
        actionCount: action.actionCount,
      };
      // Handle game-over atomically (no flicker frame between board update and overlay)
      if (action.winner) {
        return { ...next, winner: action.winner, winLine: action.winLine ?? null, screen: 'game-over' };
      }
      return next;
    }

    case 'GAME_OVER':
      return {
        ...state,
        winner: action.winner,
        winLine: action.line ?? null,
        screen: 'game-over',
      };

    case 'MOVE_PENDING':
      return { ...state, movePending: action.pending };

    case 'CHAT_MESSAGE':
      return {
        ...state,
        chatMessages: [
          ...state.chatMessages,
          { from: action.from, text: action.text, timestamp: Date.now() },
        ],
      };

    case 'OPPONENT_DISCONNECTED':
      return { ...state, opponent: null };

    case 'TOGGLE_PANEL':
      return { ...state, panelOpen: !state.panelOpen };

    case 'RETURN_TO_LOBBY':
      return {
        ...state,
        screen: 'lobby',
        roomCode: null,
        myColor: null,
        opponent: null,
        board: [],
        winner: null,
        winLine: null,
        chatMessages: [],
        lastMove: null,
        actionCount: 0,
        movePending: false,
      };

    case 'CHALLENGE_RECEIVED':
      return { ...state, challengeFrom: action.from, panelOpen: true };

    case 'CHALLENGE_DECLINED':
      return { ...state, challengeDeclinedBy: action.by };

    case 'CLEAR_CHALLENGE':
      return { ...state, challengeFrom: null, challengeDeclinedBy: null };

    case 'RESET':
      return createInitialGameState();

    default:
      return state;
  }
}
