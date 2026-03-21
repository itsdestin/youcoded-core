import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/room-manager';
import { joinRoom, handleMove, handleRematch } from '../src/room';
import type { Room } from '../src/room-manager';

let manager: RoomManager;

describe('joinRoom', () => {
  let code: string;

  beforeEach(() => {
    manager = new RoomManager();
    code = manager.createRoom('alice');
  });

  it('adds second player as yellow', () => {
    const room = manager.getRoom(code)!;
    const result = joinRoom(room, 'bob');
    expect(result.success).toBe(true);
    expect(room.players.yellow).toBe('bob');
    expect(room.status).toBe('playing');
  });

  it('rejects third player', () => {
    const room = manager.getRoom(code)!;
    joinRoom(room, 'bob');
    expect(joinRoom(room, 'charlie').success).toBe(false);
  });

  it('rejects creator joining own room', () => {
    const room = manager.getRoom(code)!;
    expect(joinRoom(room, 'alice').success).toBe(false);
  });
});

describe('handleMove', () => {
  let room: Room;

  beforeEach(() => {
    manager = new RoomManager();
    const code = manager.createRoom('alice');
    room = manager.getRoom(code)!;
    joinRoom(room, 'bob');
  });

  it('accepts valid move from correct player', () => {
    const result = handleMove(room, 'alice', 3);
    expect(result.success).toBe(true);
    expect(result.row).toBe(0);
    expect(room.turn).toBe('yellow');
  });

  it('rejects move from wrong player', () => {
    expect(handleMove(room, 'bob', 3).success).toBe(false);
  });

  it('rejects invalid column', () => {
    expect(handleMove(room, 'alice', 7).success).toBe(false);
  });

  it('detects a win', () => {
    handleMove(room, 'alice', 0);
    handleMove(room, 'bob', 0);
    handleMove(room, 'alice', 1);
    handleMove(room, 'bob', 1);
    handleMove(room, 'alice', 2);
    handleMove(room, 'bob', 2);
    const result = handleMove(room, 'alice', 3);
    expect(result.winner).toBe('red');
    expect(result.line).not.toBeNull();
    expect(room.status).toBe('finished');
  });
});

describe('handleRematch', () => {
  let room: Room;

  beforeEach(() => {
    manager = new RoomManager();
    const code = manager.createRoom('alice');
    room = manager.getRoom(code)!;
    joinRoom(room, 'bob');
    room.status = 'finished';
  });

  it('does not reset until both vote', () => {
    expect(handleRematch(room, 'alice').ready).toBe(false);
    expect(room.status).toBe('finished');
  });

  it('resets board and swaps colors when both vote', () => {
    handleRematch(room, 'alice');
    const result = handleRematch(room, 'bob');
    expect(result.ready).toBe(true);
    expect(room.status).toBe('playing');
    expect(room.players.red).toBe('bob');
    expect(room.players.yellow).toBe('alice');
  });
});
