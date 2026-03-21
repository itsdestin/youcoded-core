import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let leaderboardProcess: ChildProcess | null = null;
let relayProcess: ChildProcess | null = null;

function findTsx(serverDir: string): string {
  // Use the tsx binary from the server's node_modules
  const tsxPath = path.join(serverDir, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(tsxPath) || fs.existsSync(tsxPath + '.cmd')) {
    return tsxPath;
  }
  // Fallback to global
  return 'tsx';
}

export function startGameServers(projectRoot: string): void {
  const leaderboardDir = path.join(projectRoot, 'server', 'leaderboard');
  const relayDir = path.join(projectRoot, 'server', 'relay');

  // Ensure leaderboard data directory exists
  const dataDir = path.join(leaderboardDir, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Check if server directories and node_modules exist
  if (!fs.existsSync(path.join(leaderboardDir, 'node_modules'))) {
    console.warn('[game-servers] Leaderboard node_modules not found. Run: cd server/leaderboard && npm install');
    return;
  }
  if (!fs.existsSync(path.join(relayDir, 'node_modules'))) {
    console.warn('[game-servers] Relay node_modules not found. Run: cd server/relay && npm install');
    return;
  }

  const env = {
    ...process.env,
    LEADERBOARD_PORT: '3001',
    RELAY_PORT: '3002',
    LEADERBOARD_URL: 'http://localhost:3001',
    SHARED_SECRET: process.env.SHARED_SECRET || 'dev-secret',
    DATABASE_PATH: path.join(dataDir, 'leaderboard.db'),
  };

  // Start leaderboard API
  const leaderboardTsx = findTsx(leaderboardDir);
  leaderboardProcess = spawn(leaderboardTsx, ['src/index.ts'], {
    cwd: leaderboardDir,
    env,
    stdio: 'pipe',
    shell: true,
  });

  leaderboardProcess.stdout?.on('data', (data) => {
    console.log(`[leaderboard] ${data.toString().trim()}`);
  });
  leaderboardProcess.stderr?.on('data', (data) => {
    console.error(`[leaderboard] ${data.toString().trim()}`);
  });
  leaderboardProcess.on('exit', (code) => {
    console.log(`[leaderboard] Process exited with code ${code}`);
    leaderboardProcess = null;
  });

  // Start relay server (slight delay to let leaderboard initialize first)
  setTimeout(() => {
    const relayTsx = findTsx(relayDir);
    relayProcess = spawn(relayTsx, ['src/index.ts'], {
      cwd: relayDir,
      env,
      stdio: 'pipe',
      shell: true,
    });

    relayProcess.stdout?.on('data', (data) => {
      console.log(`[relay] ${data.toString().trim()}`);
    });
    relayProcess.stderr?.on('data', (data) => {
      console.error(`[relay] ${data.toString().trim()}`);
    });
    relayProcess.on('exit', (code) => {
      console.log(`[relay] Process exited with code ${code}`);
      relayProcess = null;
    });
  }, 1000);
}

export function stopGameServers(): void {
  if (leaderboardProcess) {
    leaderboardProcess.kill();
    leaderboardProcess = null;
  }
  if (relayProcess) {
    relayProcess.kill();
    relayProcess = null;
  }
}
