import type { Room } from './room-manager.js';
import { dropPiece, checkWin, checkDraw, createBoard } from '../../../shared/connect-four.js';

interface MoveResult {
  success: boolean;
  row?: number;
  winner?: 'red' | 'yellow' | 'draw';
  line?: [number, number][] | null;
  error?: string;
}

interface RematchResult {
  ready: boolean;
}

export function joinRoom(room: Room, username: string): { success: boolean; error?: string } {
  if (room.players.red === username) {
    return { success: false, error: 'Cannot join your own room' };
  }
  if (room.players.yellow !== null) {
    return { success: false, error: 'Room is full' };
  }
  room.players.yellow = username;
  room.status = 'playing';
  return { success: true };
}

export function handleMove(room: Room, username: string, column: number): MoveResult {
  if (room.status !== 'playing') {
    return { success: false, error: 'Game not in progress' };
  }

  const currentPlayer = room.turn === 'red' ? room.players.red : room.players.yellow;
  if (username !== currentPlayer) {
    return { success: false, error: 'Not your turn' };
  }

  const playerNum = room.turn === 'red' ? 1 : 2;
  const result = dropPiece(room.board, column, playerNum);
  if (!result) {
    return { success: false, error: 'Invalid move' };
  }

  room.board = result.board;
  const lastMove = { col: column, row: result.row };

  const winLine = checkWin(room.board, lastMove);
  if (winLine) {
    room.status = 'finished';
    return { success: true, row: result.row, winner: room.turn, line: winLine };
  }

  if (checkDraw(room.board)) {
    room.status = 'finished';
    return { success: true, row: result.row, winner: 'draw' };
  }

  room.turn = room.turn === 'red' ? 'yellow' : 'red';
  return { success: true, row: result.row };
}

export function handleRematch(room: Room, username: string): RematchResult {
  room.rematchVotes.add(username);

  if (room.rematchVotes.size < 2) {
    return { ready: false };
  }

  const oldRed = room.players.red;
  const oldYellow = room.players.yellow;
  room.players.red = oldYellow;
  room.players.yellow = oldRed;
  room.board = createBoard();
  room.turn = 'red';
  room.status = 'playing';
  room.rematchVotes.clear();

  return { ready: true };
}
