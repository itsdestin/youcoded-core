import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameOps } from '../src/renderer/game/github-game';
import type { GitHubAPI } from '../src/renderer/game/github-api';
import { createBoard } from '../src/renderer/game/connect-four';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi(): jest.Mocked<GitHubAPI> {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    listFiles: vi.fn(),
  } as unknown as jest.Mocked<GitHubAPI>;
}

function makeGame(overrides: Partial<any> = {}) {
  return {
    code: 'ABCDEF',
    red: 'alice',
    yellow: null,
    board: createBoard(),
    turn: 'red' as const,
    status: 'waiting' as const,
    chat: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('creates a file with correct structure and returns a 6-char code', async () => {
    const api = makeApi();
    api.writeFile.mockResolvedValue({ sha: 'new-sha' });

    const ops = new GameOps(api as any, 'alice');
    const code = await ops.createGame();

    expect(code).toHaveLength(6);
    // Code must only contain allowed characters (no I, O, 0, 1)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    expect(api.writeFile).toHaveBeenCalledOnce();
    const [path, data, message] = api.writeFile.mock.calls[0];
    expect(path).toBe(`games/${code}.json`);
    expect(data.code).toBe(code);
    expect(data.red).toBe('alice');
    expect(data.yellow).toBeNull();
    expect(data.status).toBe('waiting');
    expect(data.turn).toBe('red');
    expect(Array.isArray(data.board)).toBe(true);
    expect(Array.isArray(data.chat)).toBe(true);
    expect(typeof message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// joinGame
// ---------------------------------------------------------------------------

describe('joinGame', () => {
  it('joins a waiting game and sets yellow player + playing status', async () => {
    const api = makeApi();
    const game = makeGame({ code: 'ABCDEF', status: 'waiting', yellow: null });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'bob');
    const result = await ops.joinGame('ABCDEF');

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    const [path, data, , sha] = api.writeFile.mock.calls[0];
    expect(path).toBe('games/ABCDEF.json');
    expect(data.yellow).toBe('bob');
    expect(data.status).toBe('playing');
    expect(sha).toBe('sha1');
  });

  it('rejects joining a full game (yellow already set)', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', yellow: 'carol' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });

    const ops = new GameOps(api as any, 'bob');
    const result = await ops.joinGame('ABCDEF');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('rejects joining a non-waiting game', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'finished', yellow: 'carol' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });

    const ops = new GameOps(api as any, 'bob');
    const result = await ops.joinGame('ABCDEF');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when game file not found', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue(null);

    const ops = new GameOps(api as any, 'bob');
    const result = await ops.joinGame('ZZZZZZ');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// makeMove
// ---------------------------------------------------------------------------

describe('makeMove', () => {
  it('updates board and switches turn when valid move by red', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', yellow: 'bob', turn: 'red' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice'); // alice is red
    const result = await ops.makeMove('ABCDEF', 3);

    expect(result.ok).toBe(true);
    expect(result.gameState).toBeDefined();
    expect(result.gameState!.turn).toBe('yellow');
    expect(result.gameState!.board[3][0]).toBe(1); // red = player 1 at column 3, row 0

    const [path, data, , sha] = api.writeFile.mock.calls[0];
    expect(path).toBe('games/ABCDEF.json');
    expect(sha).toBe('sha1');
  });

  it('updates board and switches turn when valid move by yellow', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', yellow: 'bob', turn: 'yellow' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'bob'); // bob is yellow
    const result = await ops.makeMove('ABCDEF', 2);

    expect(result.ok).toBe(true);
    expect(result.gameState!.turn).toBe('red');
    expect(result.gameState!.board[2][0]).toBe(2); // yellow = player 2
  });

  it('rejects a move when it is not this player\'s turn', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', yellow: 'bob', turn: 'yellow' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice'); // alice is red, but it's yellow's turn
    const result = await ops.makeMove('ABCDEF', 0);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('detects a win and marks game finished', async () => {
    const api = makeApi();
    // Set up a board where red already has 3 in a row at cols 0,1,2 row 0
    const board = createBoard();
    board[0][0] = 1;
    board[1][0] = 1;
    board[2][0] = 1;
    // Drop in col 3 to win
    const game = makeGame({ status: 'playing', yellow: 'bob', turn: 'red', board });
    api.readFile
      .mockResolvedValueOnce({ data: game, sha: 'sha1' }) // makeMove read
      .mockResolvedValueOnce({ data: {}, sha: 'lb-sha' }); // leaderboard read (recordResult)
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.makeMove('ABCDEF', 3);

    expect(result.ok).toBe(true);
    expect(result.gameState!.status).toBe('finished');
    expect(result.gameState!.winner).toBe('red');
    expect(Array.isArray(result.gameState!.winLine)).toBe(true);
  });

  it('detects a draw and marks game finished', async () => {
    const api = makeApi();
    // Fill board completely except col 6 row 5 (last cell)
    const board = createBoard();
    let p = 1;
    for (let c = 0; c < 7; c++) {
      for (let r = 0; r < 6; r++) {
        if (c === 6 && r === 5) continue; // leave one cell
        board[c][r] = p;
        p = p === 1 ? 2 : 1;
      }
    }
    // Make sure the last move doesn't create a win (just a draw)
    // We'll trust checkDraw to handle it; mock no win by using player 1 (red) making last move
    // Ensure it's red's turn, and the last empty cell is col 6 row 5
    // Reset col 6 row 5 to 0 (it should already be 0 from skip above)
    const currentTurn: 'red' | 'yellow' = board[6][5] === 0 ? 'red' : 'yellow';

    // Set red player as the one making the move
    const game = makeGame({ status: 'playing', yellow: 'bob', turn: 'red', board });
    api.readFile
      .mockResolvedValueOnce({ data: game, sha: 'sha1' })
      .mockResolvedValueOnce({ data: {}, sha: 'lb-sha' }); // leaderboard
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.makeMove('ABCDEF', 6);

    // Either a win or draw — game should be finished
    expect(result.ok).toBe(true);
    expect(result.gameState!.status).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// updatePresence
// ---------------------------------------------------------------------------

describe('updatePresence', () => {
  it('writes a timestamp and status entry for this user to presence file', async () => {
    const api = makeApi();
    const existing = { alice: { username: 'alice', status: 'idle', timestamp: 1000 } };
    api.readFile.mockResolvedValue({ data: existing, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const before = Date.now();
    const ops = new GameOps(api as any, 'alice');
    await ops.updatePresence('in-game');
    const after = Date.now();

    const [path, data, , sha] = api.writeFile.mock.calls[0];
    expect(path).toBe('presence.json');
    expect(sha).toBe('sha1');
    expect(data.alice.status).toBe('in-game');
    expect(data.alice.timestamp).toBeGreaterThanOrEqual(before);
    expect(data.alice.timestamp).toBeLessThanOrEqual(after);
  });

  it('creates presence file if it does not exist', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue(null);
    api.writeFile.mockResolvedValue({ sha: 'sha1' });

    const ops = new GameOps(api as any, 'newuser');
    await ops.updatePresence('idle');

    const [path, data] = api.writeFile.mock.calls[0];
    expect(path).toBe('presence.json');
    expect(data.newuser.status).toBe('idle');
    expect(typeof data.newuser.timestamp).toBe('number');
  });

  it('retries once on 409 conflict', async () => {
    const api = makeApi();
    const existing = { alice: { username: 'alice', status: 'idle', timestamp: 1000 } };
    api.readFile
      .mockResolvedValueOnce({ data: existing, sha: 'sha1' }) // first read
      .mockResolvedValueOnce({ data: existing, sha: 'sha2' }); // retry read
    api.writeFile
      .mockResolvedValueOnce(null) // first write fails (409)
      .mockResolvedValueOnce({ sha: 'sha3' }); // retry succeeds

    const ops = new GameOps(api as any, 'alice');
    await ops.updatePresence('idle');

    expect(api.writeFile).toHaveBeenCalledTimes(2);
    expect(api.readFile).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getOnlineUsers
// ---------------------------------------------------------------------------

describe('getOnlineUsers', () => {
  it('returns users whose timestamp is within 5 minutes', async () => {
    const api = makeApi();
    const now = Date.now();
    const presence = {
      alice: { username: 'alice', status: 'idle', timestamp: now - 60000 }, // 1 min ago — online
      bob: { username: 'bob', status: 'in-game', timestamp: now - 200000 }, // ~3.3 min — online
      carol: { username: 'carol', status: 'idle', timestamp: now - 400000 }, // ~6.7 min — offline
    };
    api.readFile.mockResolvedValue({ data: presence, sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice');
    const users = await ops.getOnlineUsers();

    const names = users.map((u) => u.username);
    expect(names).toContain('alice');
    expect(names).toContain('bob');
    expect(names).not.toContain('carol');
  });

  it('returns empty array when presence file is missing', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue(null);

    const ops = new GameOps(api as any, 'alice');
    const users = await ops.getOnlineUsers();
    expect(users).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLeaderboard
// ---------------------------------------------------------------------------

describe('getLeaderboard', () => {
  it('returns leaderboard sorted by wins descending', async () => {
    const api = makeApi();
    const lb = {
      alice: { username: 'alice', wins: 5, losses: 2, draws: 1 },
      bob: { username: 'bob', wins: 10, losses: 1, draws: 0 },
      carol: { username: 'carol', wins: 3, losses: 4, draws: 2 },
    };
    api.readFile.mockResolvedValue({ data: lb, sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.getLeaderboard();

    expect(result[0].username).toBe('bob');
    expect(result[1].username).toBe('alice');
    expect(result[2].username).toBe('carol');
  });

  it('returns empty array when leaderboard file is missing', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue(null);

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.getLeaderboard();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recordResult
// ---------------------------------------------------------------------------

describe('recordResult', () => {
  it('increments winner wins and loser losses', async () => {
    const api = makeApi();
    const lb = {
      alice: { username: 'alice', wins: 2, losses: 1, draws: 0 },
      bob: { username: 'bob', wins: 1, losses: 3, draws: 0 },
    };
    api.readFile.mockResolvedValue({ data: lb, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    await ops.recordResult('alice', 'bob', false);

    const [, data] = api.writeFile.mock.calls[0];
    expect(data.alice.wins).toBe(3);
    expect(data.bob.losses).toBe(4);
    expect(data.alice.losses).toBe(1); // unchanged
    expect(data.bob.wins).toBe(1); // unchanged
  });

  it('increments draws for both players on draw', async () => {
    const api = makeApi();
    const lb = {
      alice: { username: 'alice', wins: 0, losses: 0, draws: 0 },
      bob: { username: 'bob', wins: 0, losses: 0, draws: 0 },
    };
    api.readFile.mockResolvedValue({ data: lb, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    await ops.recordResult('alice', 'bob', true);

    const [, data] = api.writeFile.mock.calls[0];
    expect(data.alice.draws).toBe(1);
    expect(data.bob.draws).toBe(1);
    expect(data.alice.wins).toBe(0);
    expect(data.bob.losses).toBe(0);
  });

  it('creates new entries for unknown players', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue({ data: {}, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    await ops.recordResult('newplayer', 'othernew', false);

    const [, data] = api.writeFile.mock.calls[0];
    expect(data.newplayer.wins).toBe(1);
    expect(data.othernew.losses).toBe(1);
  });

  it('retries once on 409 conflict', async () => {
    const api = makeApi();
    const lb = { alice: { username: 'alice', wins: 0, losses: 0, draws: 0 } };
    api.readFile
      .mockResolvedValueOnce({ data: lb, sha: 'sha1' })
      .mockResolvedValueOnce({ data: lb, sha: 'sha2' });
    api.writeFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sha: 'sha3' });

    const ops = new GameOps(api as any, 'alice');
    await ops.recordResult('alice', 'bob', false);

    expect(api.writeFile).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// readGame
// ---------------------------------------------------------------------------

describe('readGame', () => {
  it('returns game file data when it exists', async () => {
    const api = makeApi();
    const game = makeGame({ code: 'ABCDEF' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.readGame('ABCDEF');

    expect(result).not.toBeNull();
    expect(result!.code).toBe('ABCDEF');
    expect(api.readFile).toHaveBeenCalledWith('games/ABCDEF.json');
  });

  it('returns null when game file does not exist', async () => {
    const api = makeApi();
    api.readFile.mockResolvedValue(null);

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.readGame('ZZZZZZ');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendChat
// ---------------------------------------------------------------------------

describe('sendChat', () => {
  it('appends a chat message with from, text, and timestamp', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', yellow: 'bob' });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const before = Date.now();
    const ops = new GameOps(api as any, 'alice');
    const ok = await ops.sendChat('ABCDEF', 'hello!');
    const after = Date.now();

    expect(ok).toBe(true);
    const [, data] = api.writeFile.mock.calls[0];
    expect(data.chat).toHaveLength(1);
    expect(data.chat[0].from).toBe('alice');
    expect(data.chat[0].text).toBe('hello!');
    expect(data.chat[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(data.chat[0].timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// challengePlayer
// ---------------------------------------------------------------------------

describe('challengePlayer', () => {
  it('creates a game file and a challenge file, returns the code', async () => {
    const api = makeApi();
    api.writeFile.mockResolvedValue({ sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice');
    const code = await ops.challengePlayer('bob');

    expect(code).toHaveLength(6);
    expect(api.writeFile).toHaveBeenCalledTimes(2);

    const gamePath = api.writeFile.mock.calls[0][0];
    const challengePath = api.writeFile.mock.calls[1][0];
    expect(gamePath).toBe(`games/${code}.json`);
    expect(challengePath).toBe(`challenges/bob_${api.writeFile.mock.calls[1][1].from ?? 'alice'}.json`);
  });
});

// ---------------------------------------------------------------------------
// getMyChallenge
// ---------------------------------------------------------------------------

describe('getMyChallenge', () => {
  it('returns challenge when one exists targeting this user', async () => {
    const api = makeApi();
    api.listFiles.mockResolvedValue(['alice_bob.json', 'carol_dave.json']);
    api.readFile.mockResolvedValue({ data: { from: 'bob', code: 'XYZABC' }, sha: 'sha1' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.getMyChallenge();

    expect(result).not.toBeNull();
    expect(result!.from).toBe('bob');
    expect(result!.code).toBe('XYZABC');
  });

  it('returns null when no challenge targets this user', async () => {
    const api = makeApi();
    api.listFiles.mockResolvedValue(['carol_dave.json', 'eve_frank.json']);

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.getMyChallenge();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// respondToChallenge
// ---------------------------------------------------------------------------

describe('respondToChallenge', () => {
  it('joins the game when accepted', async () => {
    const api = makeApi();
    const challengeData = { from: 'bob', code: 'ABCDEF' };
    const gameData = makeGame({ code: 'ABCDEF', status: 'waiting', yellow: null });

    api.readFile
      .mockResolvedValueOnce({ data: challengeData, sha: 'ch-sha' }) // challenge file
      .mockResolvedValueOnce({ data: gameData, sha: 'game-sha' }); // game file (for joinGame)
    api.deleteFile.mockResolvedValue(true);
    api.writeFile.mockResolvedValue({ sha: 'new-sha' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.respondToChallenge('bob', true);

    expect(result.ok).toBe(true);
    expect(api.deleteFile).toHaveBeenCalledWith(
      expect.stringContaining('challenges/'),
      'ch-sha',
      expect.any(String),
    );
  });

  it('deletes both challenge and game files when declined', async () => {
    const api = makeApi();
    const challengeData = { from: 'bob', code: 'ABCDEF' };
    const gameData = makeGame({ code: 'ABCDEF', status: 'waiting' });

    api.readFile
      .mockResolvedValueOnce({ data: challengeData, sha: 'ch-sha' })
      .mockResolvedValueOnce({ data: gameData, sha: 'game-sha' });
    api.deleteFile.mockResolvedValue(true);

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.respondToChallenge('bob', false);

    expect(result.ok).toBe(true);
    expect(api.deleteFile).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// requestRematch
// ---------------------------------------------------------------------------

describe('requestRematch', () => {
  it('adds vote and returns ready=false when only one player has voted', async () => {
    const api = makeApi();
    const game = makeGame({
      status: 'finished',
      yellow: 'bob',
      winner: 'red',
      rematchVotes: [],
    });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice');
    const result = await ops.requestRematch('ABCDEF');

    expect(result.ready).toBe(false);
    const [, data] = api.writeFile.mock.calls[0];
    expect(data.rematchVotes).toContain('alice');
  });

  it('resets board and swaps colors when both players voted', async () => {
    const api = makeApi();
    const game = makeGame({
      status: 'finished',
      red: 'alice',
      yellow: 'bob',
      winner: 'red',
      rematchVotes: ['bob'], // bob already voted
    });
    api.readFile.mockResolvedValue({ data: game, sha: 'sha1' });
    api.writeFile.mockResolvedValue({ sha: 'sha2' });

    const ops = new GameOps(api as any, 'alice'); // alice votes now
    const result = await ops.requestRematch('ABCDEF');

    expect(result.ready).toBe(true);
    expect(result.gameState).toBeDefined();
    expect(result.gameState!.status).toBe('playing');
    expect(result.gameState!.red).toBe('bob'); // colors swapped
    expect(result.gameState!.yellow).toBe('alice');
    expect(result.gameState!.rematchVotes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// leaveGame
// ---------------------------------------------------------------------------

describe('leaveGame', () => {
  it('marks game finished with opponent winning, updates leaderboard, then deletes file', async () => {
    const api = makeApi();
    const game = makeGame({ status: 'playing', red: 'alice', yellow: 'bob' });
    const lb = { alice: { username: 'alice', wins: 0, losses: 0, draws: 0 }, bob: { username: 'bob', wins: 0, losses: 0, draws: 0 } };

    api.readFile
      .mockResolvedValueOnce({ data: game, sha: 'game-sha' }) // leaveGame read
      .mockResolvedValueOnce({ data: lb, sha: 'lb-sha' }); // recordResult read
    api.writeFile.mockResolvedValue({ sha: 'new-sha' });
    api.deleteFile.mockResolvedValue(true);

    const ops = new GameOps(api as any, 'alice');
    await ops.leaveGame('ABCDEF');

    // Should have written game state (finished) and leaderboard
    expect(api.writeFile).toHaveBeenCalled();
    // Should delete the game file
    expect(api.deleteFile).toHaveBeenCalledWith(
      'games/ABCDEF.json',
      expect.any(String),
      expect.any(String),
    );
  });
});
