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

// ── Migration: merge auth_type + auth_mode into one 3-way axis ───────────
// auth_type (key|password, "which credential") and auth_mode (otp|password,
// "which handshake") never varied independently: OTP already ignored
// auth_type entirely, and auth_mode='password' never changed the credential.
// Collapse both into auth_mode: key | password | otp. A row's OTP flag only
// carries over if it was actually honored (internal transport); otherwise the
// merged value falls back to the credential it was already using.
if (serverCols.some(c => c.name === 'auth_type')) {
  db.exec(`
    UPDATE servers
    SET auth_mode = CASE
      WHEN auth_mode = 'otp' AND connection_method = 'internal' THEN 'otp'
      ELSE auth_type
    END
  `);
  db.exec(`ALTER TABLE servers DROP COLUMN auth_type`);
}

// ── Migration: per-server explorer + terminal axes ────────────────────────
// Explorer and terminal used to be implied by connection_method. They are now
// first-class per-server axes, freely chosen on external transport:
//   explorer_mode: 'sftp'       (SFTP subsystem)        | 'onechannel' (base64 over a shell)
//   terminal_mode: 'pty'        (live interactive PTY)  | 'console'    (one-shot command panel)
// New columns default to the internal-safe modes; existing external rows are
// backfilled to sftp/pty so already-configured servers keep behaving exactly
// as before. (Internal transport can only do onechannel/console — the gateway
// grants a single channel — so it keeps the defaults.)
if (!serverCols.some(c => c.name === 'explorer_mode')) {
  db.exec(`ALTER TABLE servers ADD COLUMN explorer_mode TEXT DEFAULT 'onechannel'`);
  db.prepare(`UPDATE servers SET explorer_mode='sftp' WHERE connection_method='external'`).run();
}
if (!serverCols.some(c => c.name === 'terminal_mode')) {
  db.exec(`ALTER TABLE servers ADD COLUMN terminal_mode TEXT DEFAULT 'console'`);
  db.prepare(`UPDATE servers SET terminal_mode='pty' WHERE connection_method='external'`).run();
}

// Seed default settings if not already present.
// Fresh installs default to OTP globally (OTP-first); existing DBs keep their
// stored value since INSERT OR IGNORE is a no-op when the row already exists.
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_mode', 'otp')`).run();
// Auth flow scope: 'global' (one switch rules all) vs 'standalone' (per-server).
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_scope', 'global')`).run();

// ── Global defaults for every connection axis ─────────────────────────────
// Each per-server axis has a tool-wide default applied when config_scope is
// 'global'. `config_scope` generalizes the old `auth_scope` (which only ruled
// the auth axis) to govern all four axes; it is seeded from auth_scope so an
// upgrade preserves the user's existing global/standalone choice.
// default_auth_mode is key | password | otp (see the auth_type/auth_mode
// merge migration above) — a 'key' default still resolves each server's own
// stored key_path, since credentials themselves stay per-server.
const _authScope = db.prepare(`SELECT value FROM settings WHERE key='auth_scope'`).get();
const _authDef   = db.prepare(`SELECT value FROM settings WHERE key='auth_mode'`).get();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('config_scope', ?)`).run(_authScope?.value || 'global');
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_connection_method', 'internal')`).run();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_auth_mode', ?)`).run(_authDef?.value || 'otp');
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_explorer_mode', 'onechannel')`).run();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_terminal_mode', 'console')`).run();

module.exports = db;
