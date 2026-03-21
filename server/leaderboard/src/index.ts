import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { createDb } from './db.js';
import { createApp } from './routes.js';

const PORT = parseInt(process.env.LEADERBOARD_PORT || '3001');
const DB_PATH = process.env.DATABASE_PATH || './data/leaderboard.db';
const SHARED_SECRET = process.env.SHARED_SECRET || 'dev-secret';

// Ensure the data directory exists before creating the DB file
if (DB_PATH !== ':memory:') {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = createDb(DB_PATH);
const app = createApp(db, SHARED_SECRET);

app.listen(PORT, () => {
  console.log(`Leaderboard API listening on port ${PORT}`);
});
