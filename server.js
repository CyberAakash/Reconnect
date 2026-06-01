const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');
const multer = require('multer');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 9898;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const DATA_DIR = process.env.DATA_DIR || __dirname;

// ── Encryption key ──
// Priority: ENCRYPTION_KEY env var (for stateless/cloud deploys)
//           → .secret file (for local / persistent-disk deploys)
let ENCRYPTION_KEY;
if (process.env.ENCRYPTION_KEY) {
  ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY.trim().slice(0, 64), 'hex');
} else {
  const SECRET_FILE = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(SECRET_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  ENCRYPTION_KEY = Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim().slice(0, 64), 'hex');
}
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

app.use(express.json());
app.use(cookieParser());

const upload = multer({ dest: path.join(__dirname, 'uploads') });

// ════════════════════════════════════════
//  APP-LEVEL AUTH
// ════════════════════════════════════════

const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET ||
  (process.env.ENCRYPTION_KEY ? process.env.ENCRYPTION_KEY.slice(0, 64) : null);
const COOKIE_NAME = 'rt_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// In production with no APP_PASSWORD set, refuse to start.
if (process.env.NODE_ENV === 'production' && !APP_PASSWORD) {
  // eslint-disable-next-line no-console
  console.error('\x1b[31m[FATAL] APP_PASSWORD must be set in production. Exiting.\x1b[0m');
  process.exit(1);
}

const AUTH_ENABLED = Boolean(APP_PASSWORD);

function makeSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function signToken(token) {
  const secret = SESSION_SECRET || ENCRYPTION_KEY.toString('hex');
  return token + '.' + crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function verifyToken(signed) {
  if (!signed || typeof signed !== 'string') return false;
  const dot = signed.lastIndexOf('.');
  if (dot === -1) return false;
  const token = signed.slice(0, dot);
  const expected = signToken(token);
  return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
}

// /api/* always gets 401 JSON — never a redirect (fetch can't follow 302 to /login)
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (verifyToken(req.cookies[COOKIE_NAME])) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Serve /login (must come before static so login.html is reachable when unauthenticated)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Gate the app entry point — redirect to /login when unauthenticated
app.get(['/', '/index.html'], (req, res, next) => {
  if (!AUTH_ENABLED || verifyToken(req.cookies[COOKIE_NAME])) return next();
  res.redirect('/login');
});

// Static files (index.html served here for authenticated requests)
app.use(express.static(path.join(__dirname, 'public')));

// Gate + serve documentation assets (docs/index.html, the PDF deck, screenshots)
app.use('/docs', (req, res, next) => {
  if (!AUTH_ENABLED || verifyToken(req.cookies[COOKIE_NAME])) return next();
  res.redirect('/login');
}, express.static(path.join(__dirname, 'docs')));

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!AUTH_ENABLED || password === APP_PASSWORD) {
    const token = makeSessionToken();
    const signed = signToken(token);
    res.cookie(COOKIE_NAME, signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Protect all /api/* routes (except /api/login and /api/logout already handled above)
app.use('/api', requireAuth);

// ── SSH config builder ──
function sshConfig(server, mode) {
  const config = {
    host: server.host,
    port: server.port,
    username: server.username,
  };
  if (mode === 'otp') {
    // Use system SSH agent (0Agent / ZAC cert) + allow keyboard-interactive for OTP
    if (process.env.SSH_AUTH_SOCK) config.agent = process.env.SSH_AUTH_SOCK;
    config.tryKeyboard = true;
  } else if (server.auth_type === 'key') {
    config.privateKey = fs.readFileSync(server.key_path, 'utf8');
  } else {
    config.password = decrypt(server.password);
    config.tryKeyboard = true;
  }
  return config;
}

// ════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════

function getAuthMode() {
  const row = db.prepare(`SELECT value FROM settings WHERE key='auth_mode'`).get();
  return row ? row.value : 'legacy';
}

app.get('/api/settings', (req, res) => {
  const auth_mode = getAuthMode();
  res.json({ auth_mode });
});

app.put('/api/settings', (req, res) => {
  const { auth_mode } = req.body;
  if (!['legacy', 'otp'].includes(auth_mode)) {
    return res.status(400).json({ error: 'Invalid auth_mode' });
  }
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_mode', ?)`).run(auth_mode);
  // Drop all pooled sessions so each server re-auths under the new mode
  for (const [, session] of sessions) {
    clearTimeout(session.idleTimer);
    try { session.conn.end(); } catch (_) {}
  }
  sessions.clear();
  res.json({ ok: true, auth_mode });
});

// ════════════════════════════════════════
//  SESSION POOL
// ════════════════════════════════════════

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// sessions map: serverId -> { conn, status: 'connecting'|'awaiting_otp'|'ready', otpFinish, idleTimer, connectResolvers }
const sessions = new Map();

function clearSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.idleTimer);
  try { s.conn.end(); } catch (_) {}
  sessions.delete(id);
}

function resetIdle(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
}

/**
 * Legacy mode: auto-connect silently with stored credentials.
 * Returns a Promise<conn>.
 */
function ensureSession(id) {
  const existing = sessions.get(id);
  if (existing && existing.status === 'ready') {
    resetIdle(id);
    return Promise.resolve(existing.conn);
  }
  // If currently connecting, queue up a resolver
  if (existing && existing.status === 'connecting') {
    return new Promise((resolve, reject) => {
      existing.connectResolvers.push({ resolve, reject });
    });
  }

  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return Promise.reject(new Error('Server not found'));

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const session = {
      conn,
      status: 'connecting',
      otpFinish: null,
      idleTimer: null,
      connectResolvers: [{ resolve, reject }],
    };
    sessions.set(id, session);

    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(prompts.map(() => decrypt(server.password)));
    });

    conn.on('ready', () => {
      session.status = 'ready';
      session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
      session.connectResolvers.forEach(r => r.resolve(conn));
      session.connectResolvers = [];
    });

    conn.on('error', (err) => {
      session.connectResolvers.forEach(r => r.reject(err));
      session.connectResolvers = [];
      sessions.delete(id);
    });

    conn.on('close', () => {
      if (sessions.get(id) === session) sessions.delete(id);
    });

    conn.connect(sshConfig(server, 'legacy'));
  });
}

/**
 * OTP mode: return ready conn or throw NOT_CONNECTED (user must click Connect).
 */
function getSession(id) {
  const s = sessions.get(id);
  if (s && s.status === 'ready') {
    resetIdle(id);
    return s.conn;
  }
  const err = new Error('NOT_CONNECTED');
  err.code = 'NOT_CONNECTED';
  throw err;
}

/**
 * Route-level helper: branches on current auth_mode.
 */
async function acquire(id) {
  const mode = getAuthMode();
  if (mode === 'otp') {
    return getSession(id);
  }
  return ensureSession(id);
}

// ════════════════════════════════════════
//  SERVER CRUD
// ════════════════════════════════════════

app.get('/api/servers', (req, res) => {
  const servers = db.prepare('SELECT id, label, host, port, username, auth_type, key_path FROM servers ORDER BY label').all();
  res.json(servers);
});

app.post('/api/servers', (req, res) => {
  const { label, host, port, username, auth_type, password, key_path } = req.body;
  const encPass = auth_type === 'password' ? encrypt(password) : '';
  const info = db.prepare('INSERT INTO servers (label, host, port, username, auth_type, password, key_path) VALUES (?,?,?,?,?,?,?)').run(label, host, port || 22, username, auth_type || 'password', encPass, key_path || '');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/servers/:id', (req, res) => {
  const { label, host, port, username, auth_type, password, key_path } = req.body;
  const encPass = auth_type === 'password' && password ? encrypt(password) : undefined;
  if (encPass !== undefined) {
    db.prepare('UPDATE servers SET label=?, host=?, port=?, username=?, auth_type=?, password=?, key_path=? WHERE id=?')
      .run(label, host, port || 22, username, auth_type, encPass, key_path || '', req.params.id);
  } else {
    db.prepare('UPDATE servers SET label=?, host=?, port=?, username=?, auth_type=?, key_path=? WHERE id=?')
      .run(label, host, port || 22, username, auth_type, key_path || '', req.params.id);
  }
  // Drop pooled session so next op re-connects with new creds
  clearSession(+req.params.id);
  res.json({ ok: true });
});

app.delete('/api/servers/:id', (req, res) => {
  clearSession(+req.params.id);
  db.prepare('DELETE FROM servers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Session status / test connection
app.post('/api/servers/:id/test', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const mode = getAuthMode();
  if (mode === 'otp') {
    const s = sessions.get(id);
    const status = s ? s.status : 'disconnected';
    return res.json({ ok: status === 'ready', status });
  }
  try {
    await ensureSession(id);
    res.json({ ok: true, status: 'ready' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════
//  CONNECTION LIFECYCLE (OTP mode)
// ════════════════════════════════════════

// SSE endpoint — initiates SSH connection and streams events back to the UI
app.get('/api/servers/:id/connect', (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) { res.status(404).end(); return; }

  // Drop any existing session first
  clearSession(id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sse(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const mode = getAuthMode();
  const conn = new Client();
  const session = {
    conn,
    status: 'connecting',
    otpFinish: null,
    idleTimer: null,
    connectResolvers: [],
  };
  sessions.set(id, session);

  if (mode === 'otp') {
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      session.status = 'awaiting_otp';
      session.otpFinish = finish;
      const promptText = prompts.length > 0 ? prompts[0].prompt : 'OTP:';
      sse('prompt', { prompt: promptText });
    });
  } else if (server.auth_type !== 'key') {
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(prompts.map(() => decrypt(server.password)));
    });
  }

  conn.on('ready', () => {
    session.status = 'ready';
    session.otpFinish = null;
    session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
    sse('connected', { serverId: id });
    res.end();
  });

  conn.on('error', (err) => {
    sse('error', { message: err.message });
    sessions.delete(id);
    res.end();
  });

  conn.on('close', () => {
    if (sessions.get(id) === session) sessions.delete(id);
  });

  conn.connect(sshConfig(server, mode));

  req.on('close', () => {
    // If SSE dropped before ready, clean up
    if (session.status !== 'ready') clearSession(id);
  });
});

// Receive OTP from the UI and forward to the SSH keyboard-interactive callback
app.post('/api/servers/:id/otp', (req, res) => {
  const id = +req.params.id;
  const session = sessions.get(id);
  if (!session || !session.otpFinish) {
    return res.status(400).json({ error: 'No pending OTP challenge for this server' });
  }
  const { otp } = req.body;
  session.otpFinish([otp || '']);
  session.otpFinish = null;
  res.json({ ok: true });
});

// Explicitly disconnect
app.post('/api/servers/:id/disconnect', (req, res) => {
  clearSession(+req.params.id);
  res.json({ ok: true });
});

// Session status poll
app.get('/api/servers/:id/status', (req, res) => {
  const id = +req.params.id;
  const s = sessions.get(id);
  res.json({ status: s ? s.status : 'disconnected' });
});

// ════════════════════════════════════════
//  COMMAND CRUD
// ════════════════════════════════════════

app.get('/api/commands', (req, res) => {
  const cmds = db.prepare('SELECT * FROM commands ORDER BY label').all();
  res.json(cmds);
});

app.post('/api/commands', (req, res) => {
  const { label, command } = req.body;
  const info = db.prepare('INSERT INTO commands (label, command) VALUES (?,?)').run(label, command);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/commands/:id', (req, res) => {
  const { label, command } = req.body;
  db.prepare('UPDATE commands SET label=?, command=? WHERE id=?').run(label, command, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/commands/:id', (req, res) => {
  db.prepare('DELETE FROM commands WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════
//  SAVED FILES CRUD
// ════════════════════════════════════════

app.get('/api/files', (req, res) => {
  const files = db.prepare('SELECT * FROM saved_files ORDER BY label').all();
  res.json(files);
});

app.post('/api/files', (req, res) => {
  const { label, path } = req.body;
  const info = db.prepare('INSERT INTO saved_files (label, path) VALUES (?,?)').run(label, path);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/files/:id', (req, res) => {
  const { label, path } = req.body;
  db.prepare('UPDATE saved_files SET label=?, path=? WHERE id=?').run(label, path, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/files/:id', (req, res) => {
  db.prepare('DELETE FROM saved_files WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════
//  EXECUTE COMMAND (SSE streaming) — pooled
// ════════════════════════════════════════

app.get('/api/servers/:id/exec', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const cmd = req.query.cmd;
  if (!cmd) return res.status(400).json({ error: 'No command provided' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', data: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message })}\n\n`);
    res.end();
    return;
  }

  conn.exec(cmd, (err, stream) => {
    if (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`);
      res.end();
      return;
    }
    stream.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stdout', data: data.toString() })}\n\n`);
    });
    stream.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', data: data.toString() })}\n\n`);
    });
    stream.on('close', (code) => {
      res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
      res.end();
    });
  });

  req.on('close', () => { /* keep conn alive — it's pooled */ });
});

// ════════════════════════════════════════
//  SYSTEM INFO — pooled
// ════════════════════════════════════════

app.get('/api/servers/:id/sysinfo', async (req, res) => {
  const id = +req.params.id;
  let conn;
  try { conn = await acquire(id); }
  catch (err) {
    return res.status(409).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : err.message });
  }

  // Build script using an array joined with semicolons
  // Avoid complex shell quoting — use separate echo assignments
  const scriptParts = [
    'echo "HOST=$(hostname 2>/dev/null)"',
    '. /etc/os-release 2>/dev/null; echo "OS=${PRETTY_NAME:-$(uname -s)}"',
    'echo "KERNEL=$(uname -r)"',
    'echo "ARCH=$(uname -m)"',
    'echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"',
    'echo "CPUS=$(nproc 2>/dev/null)"',
    'echo "LOAD=$(awk \'{print $1,$2,$3}\' /proc/loadavg 2>/dev/null)"',
    'MU=$(free -m 2>/dev/null | grep "^Mem:" | awk "{print \\$3}"); MT=$(free -m 2>/dev/null | grep "^Mem:" | awk "{print \\$2}"); echo "MEM=${MU}/${MT}"',
    'DU=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$3}"); DT=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$2}"); DP=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$5}"); echo "DISK=${DU}/${DT} (${DP})"',
  ];
  const script = scriptParts.join('; ');

  conn.exec(script, (err, stream) => {
    if (err) return res.status(500).json({ error: err.message });
    let out = '';
    stream.on('data', d => { out += d.toString(); });
    stream.stderr.on('data', () => {}); // drain stderr
    stream.on('close', () => {
      const info = {};
      out.split('\n').forEach(line => {
        const i = line.indexOf('=');
        if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim();
      });
      res.json(info);
    });
  });
});

// ════════════════════════════════════════
//  FILE OPERATIONS (SFTP) — pooled
// ════════════════════════════════════════

// Upload file
app.post('/api/servers/:id/upload', upload.single('file'), async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const remotePath = req.body.remotePath;
  const localPath = req.file.path;

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    fs.unlink(localPath, () => {});
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

  conn.sftp((err, sftp) => {
    if (err) { fs.unlink(localPath, () => {}); return res.status(500).json({ error: err.message }); }
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);
    writeStream.on('close', () => { sftp.end(); fs.unlink(localPath, () => {}); res.json({ ok: true }); });
    writeStream.on('error', (e) => { sftp.end(); fs.unlink(localPath, () => {}); res.status(500).json({ error: e.message }); });
    readStream.pipe(writeStream);
  });
});

// Read remote file
app.post('/api/servers/:id/file/read', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

  const remotePath = req.body.path;
  conn.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    let content = '';
    let responded = false;
    const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
    stream.on('data', (chunk) => { content += chunk; });
    stream.on('end', () => { if (responded) return; responded = true; sftp.end(); res.json({ content }); });
    stream.on('error', (e) => { if (responded) return; responded = true; sftp.end(); res.status(500).json({ error: e.message }); });
  });
});

// Write remote file
app.post('/api/servers/:id/file/write', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

  const { path: remotePath, content } = req.body;
  conn.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    const stream = sftp.createWriteStream(remotePath);
    stream.on('close', () => { sftp.end(); res.json({ ok: true }); });
    stream.on('error', (e) => { sftp.end(); res.status(500).json({ error: e.message }); });
    stream.end(content, 'utf8');
  });
});

// List remote directory
app.post('/api/servers/:id/file/list', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

  const dirPath = req.body.path;
  conn.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    sftp.readdir(dirPath, (e, list) => {
      sftp.end();
      if (e) return res.status(500).json({ error: e.message });
      const entries = list
        .map(item => ({
          name: item.filename,
          isDir: item.attrs.isDirectory(),
          size: item.attrs.size,
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.json({ path: dirPath, entries });
    });
  });
});

// Delete remote file
app.post('/api/servers/:id/file/delete', async (req, res) => {
  const id = +req.params.id;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

  const filePath = req.body.path;
  conn.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    sftp.unlink(filePath, (e) => {
      sftp.end();
      if (e) return res.status(500).json({ error: e.message });
      res.json({ ok: true });
    });
  });
});

// ════════════════════════════════════════
//  FALLBACK: system SSH ControlMaster
// ════════════════════════════════════════
//
// If the ZAC cert is NOT available via SSH_AUTH_SOCK (i.e. `process.env.SSH_AUTH_SOCK`
// is unset or ssh2 fails to pick up the agent cert), swap the OTP connect path to
// shell out to the system `ssh` binary using ControlMaster multiplexing:
//
//   const socketPath = `/tmp/rt_ssh_${id}_${Date.now()}.sock`;
//   const master = spawn('ssh', [
//     '-M', '-S', socketPath,
//     '-o', 'ControlPersist=30m',
//     '-o', 'StrictHostKeyChecking=no',
//     `${server.username}@${server.host}`,
//     '-p', server.port,
//     '-o', 'BatchMode=no',  // allow keyboard-interactive
//   ], { stdio: ['pipe', 'pipe', 'pipe'] });
//
// Then watch master.stdout/stderr for the "Enter OTP:" prompt, stream it as SSE,
// receive the OTP via POST /otp, write it to master.stdin, and wait for the
// "ControlMaster socket" ready line. All subsequent ops run as:
//
//   exec: ssh -S socketPath -o ControlPath=socketPath ... 'command'
//   sftp: sftp -o ControlPath=socketPath ...
//
// Same pool map; replace conn with { socketPath, masterProcess }.
//
// This path guarantees identical behaviour to `ssh sas@<IP>` in the terminal.

// ════════════════════════════════════════
//  STARTUP BANNER
// ════════════════════════════════════════

/* eslint-disable no-console */
function printBanner(port) {
  const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    cyan:   '\x1b[36m',
    blue:   '\x1b[34m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    magenta:'\x1b[35m',
    white:  '\x1b[97m',
    gray:   '\x1b[90m',
  };

  const art = [
    `${c.cyan}${c.bold}  ██████╗ ███████╗ ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗${c.reset}`,
    `${c.cyan}${c.bold}  ██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝${c.reset}`,
    `${c.blue}${c.bold}  ██████╔╝█████╗  ██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║   ${c.reset}`,
    `${c.blue}${c.bold}  ██╔══██╗██╔══╝  ██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║   ${c.reset}`,
    `${c.magenta}${c.bold}  ██║  ██║███████╗╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║   ${c.reset}`,
    `${c.magenta}${c.bold}  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═╝   ${c.reset}`,
  ];

  const taglines = [
    'Tunneling through the matrix...',
    'May your sockets never close.',
    'SSH: Secretly Sipping Hummus.',
    'Packets delivered. Dignity intact.',
    'Bridging the gap between you and root access.',
    'Because RDP is for quitters.',
    'Your servers called. They miss you.',
    'Latency is just the universe saying "hello" slowly.',
    'if (connected) { happiness++ }',
    'Now loading: someone else\'s CPU problems.',
  ];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];

  const now = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour12: false });
  const nodeVer = process.version;
  const pid = process.pid;

  const divider = `${c.gray}  ${'─'.repeat(80)}${c.reset}`;

  console.log('');
  art.forEach(line => console.log(line));
  console.log('');
  console.log(divider);
  console.log(divider);
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`${c.bold}  ➜  Local:   ${c.reset}${c.cyan}${c.bold}http://${displayHost}:${port}${c.reset}`);
  console.log('');
  const authStatus = AUTH_ENABLED ? `${c.green}auth enabled${c.reset}` : `${c.yellow}auth disabled (dev mode)${c.reset}`;
  console.log(`${c.gray}  PID ${pid}  │  Node ${nodeVer}  │  ${time}${c.reset}  │  ${authStatus}`);
  const mode = process.env.NODE_ENV === 'production' ? `${c.green}production${c.reset}` : `${c.yellow}development${c.reset}`;
  const hotReload = process.env.npm_lifecycle_event === 'dev' ? `${c.cyan} (nodemon)${c.reset}` : '';
  console.log(`${c.gray}  Mode: ${mode}${hotReload}  │  Help: ${c.cyan}http://${displayHost}:${port}/docs${c.reset}`);
  const isPM2 = process.env.pm_id !== undefined;
  if (isPM2) {
    console.log(`${c.gray}  PM2 managed  │  pm2 logs reconnect  │  pm2 restart reconnect${c.reset}`);
  } else {
    console.log(`${c.gray}  Tip: run under PM2 for auto-start → pm2 start npm --name reconnect -- start${c.reset}`);
  }
  console.log(`${c.magenta}  ~ "${tagline}"${c.reset}`);
  console.log(divider);
  console.log('');
}
/* eslint-enable no-console */

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════

const httpServer = app.listen(PORT, HOST, () => {
  printBanner(PORT);
});

// ════════════════════════════════════════
//  WEBSOCKET SHELL (PTY)
// ════════════════════════════════════════

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', async (ws, req) => {
  // Auth gate for WebSocket connections
  if (AUTH_ENABLED) {
    const rawCookies = req.headers.cookie || '';
    const cookieMap = Object.fromEntries(
      rawCookies.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
    );
    if (!verifyToken(cookieMap[COOKIE_NAME])) {
      ws.close(1008, 'Unauthorized');
      return;
    }
  }

  const match = req.url.match(/^\/api\/servers\/(\d+)\/shell/);
  if (!match) { ws.close(1008, 'Invalid path'); return; }
  const id = +match[1];

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close();
    return;
  }

  // Default PTY size — client will send a resize frame immediately
  let cols = 120;
  let rows = 30;

  conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
      return;
    }

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'resize') {
          cols = data.cols || cols;
          rows = data.rows || rows;
          stream.setWindow(rows, cols, 0, 0);
          return;
        }
      } catch (_) { /* not JSON — raw keystroke */ }
      if (stream.writable) stream.write(typeof msg === 'string' ? msg : Buffer.from(msg));
    });

    stream.on('data', (chunk) => {
      if (ws.readyState === 1 /* OPEN */) ws.send(chunk);
    });
    stream.stderr.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk);
    });

    stream.on('close', () => { ws.close(); });
    ws.on('close', () => { stream.end(); });
    ws.on('error', () => { stream.end(); });
  });
});
