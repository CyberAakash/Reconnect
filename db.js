const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT DEFAULT 'password',
    password TEXT DEFAULT '',
    key_path TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    command TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    path TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Migration: per-server auth flow ──────────────────────────────────────
// Add `auth_mode` to servers so each server can run its own connection flow.
// New rows default to 'otp'; pre-existing rows are backfilled to 'legacy' so
// upgrades don't change how already-configured servers connect.
const serverCols = db.prepare(`PRAGMA table_info(servers)`).all();
if (!serverCols.some(c => c.name === 'auth_mode')) {
  db.exec(`ALTER TABLE servers ADD COLUMN auth_mode TEXT DEFAULT 'otp'`);
  db.prepare(`UPDATE servers SET auth_mode='legacy'`).run();
}

// ── Migration: connection method (transport) ──────────────────────────────
// Each server picks a transport independent of its auth flow:
//   'internal' → tunnel through the zero-trust proxy + single-shell RPC
//   'external' → direct SSH + full exec/SFTP/PTY channels (password/key only)
// Existing rows inherit 'internal' via the column DEFAULT (they were all reached
// through the proxy under the old OTP flow), so no separate backfill is needed.
if (!serverCols.some(c => c.name === 'connection_method')) {
  db.exec(`ALTER TABLE servers ADD COLUMN connection_method TEXT DEFAULT 'internal'`);
}

// ── Migration: rename auth flow value 'legacy' → 'password' ───────────────
// 'legacy' used to mean "direct + password"; transport is now its own axis
// (connection_method), so the auth axis is simply otp | password. Idempotent:
// no rows match once renamed.
db.prepare(`UPDATE servers SET auth_mode='password' WHERE auth_mode='legacy'`).run();
db.prepare(`UPDATE settings SET value='password' WHERE key='auth_mode' AND value='legacy'`).run();

// Seed default settings if not already present.
// Fresh installs default to OTP globally (OTP-first); existing DBs keep their
// stored value since INSERT OR IGNORE is a no-op when the row already exists.
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_mode', 'otp')`).run();
// Auth flow scope: 'global' (one switch rules all) vs 'standalone' (per-server).
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_scope', 'global')`).run();

module.exports = db;
