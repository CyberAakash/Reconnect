const express = require('express');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
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
    // Keep idle sessions alive (the zero-trust gateway/NAT drops silent
    // connections). Ping every 15s; give up after ~2 min of no reply.
    keepaliveInterval: 15000,
    keepaliveCountMax: 8,
  };
  if (mode === 'otp') {
    // Org OTP flow: server authenticates via a single one-time passcode over
    // keyboard-interactive. Force ssh2 straight to it — no agent/publickey/
    // password attempts to muddy the negotiation (the agent has no identities,
    // and a dead publickey attempt makes ssh2 report "all methods failed"
    // before it ever reaches the OTP prompt).
    config.tryKeyboard = true;
    config.authHandler = ['keyboard-interactive'];
    // Give the user time to receive the OTP email and type it (default is 20s).
    config.readyTimeout = 120000;
  } else if (server.auth_type === 'key') {
    config.privateKey = fs.readFileSync(server.key_path, 'utf8');
  } else {
    config.password = decrypt(server.password);
    config.tryKeyboard = true;
  }
  return config;
}

// ── Zero-trust egress proxy ──
// Internal hosts (e.g. the OTP/zero-trust gateway) only resolve correctly when
// reached THROUGH the local zero-trust agent's HTTP CONNECT proxy. Connecting
// directly hits a different machine on the same overlay IP and auth fails.
// Mirrors the system ~/.ssh/config managed by 0Helper:
//   ProxyCommand /usr/bin/nc -X connect -x 127.0.0.1:3128 %h %p
const SSH_PROXY = process.env.RECONNECT_SSH_PROXY || '127.0.0.1:3128';

// Open an HTTP CONNECT tunnel through SSH_PROXY to targetHost:targetPort and
// resolve with the tunneled socket, ready to hand to ssh2 as config.sock.
function connectViaProxy(targetHost, targetPort) {
  const sep = SSH_PROXY.lastIndexOf(':');
  const proxyHost = sep === -1 ? SSH_PROXY : SSH_PROXY.slice(0, sep);
  const proxyPort = sep === -1 ? 3128 : Number(SSH_PROXY.slice(sep + 1));

  return new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, proxyHost);
    let chunks = [];
    let settled = false;

    const cleanup = () => {
      sock.removeListener('data', onData);
      sock.removeListener('error', onErr);
      sock.setTimeout(0);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      sock.destroy();
      reject(err);
    };
    const onErr = (e) => fail(e);
    const onData = (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return; // wait for full CONNECT response header
      const statusLine = buf.slice(0, buf.indexOf('\r\n')).toString('latin1');
      const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
      if (!m || m[1] !== '200') {
        return fail(new Error(`zero-trust proxy refused CONNECT (${statusLine || 'no response'})`));
      }
      settled = true;
      cleanup();
      // Bytes after the header already belong to the SSH stream (server banner);
      // push them back so ssh2 reads them.
      const leftover = buf.slice(headerEnd + 4);
      if (leftover.length) sock.unshift(leftover);
      resolve(sock);
    };

    sock.setTimeout(15000, () => fail(new Error(`zero-trust proxy ${proxyHost}:${proxyPort} timed out`)));
    sock.once('error', onErr);
    sock.on('data', onData);
    sock.once('connect', () => {
      sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
  });
}

// ════════════════════════════════════════
//  REMOTE SHELL (RPC over a single PTY shell)
// ════════════════════════════════════════
//
// The zero-trust OTP gateway allows exactly ONE session channel per login, and
// only an interactive shell (no exec, no sftp). So in OTP mode we open that one
// shell once and drive it as a command/response RPC channel: every operation is
// a shell command whose output is captured up to a unique sentinel marker. File
// contents move as base64 to stay binary-safe.

// POSIX single-quote a string for safe interpolation into a shell command.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const RPC_DEFAULT_TIMEOUT_MS = 30000;
const RPC_MAX_OUTPUT = 12 * 1024 * 1024; // 12 MB guard per command
const FILE_READ_CAP = 8 * 1024 * 1024;   // 8 MB cap for file reads/downloads

class RemoteShell {
  constructor(stream, marker) {
    this.stream = stream;
    this.marker = marker;
    this.buf = '';
    this.queue = Promise.resolve(); // serializes run() calls
    this.closed = false;
    this.endRe = new RegExp(`${marker}:(\\-?\\d+):EOF`);

    stream.on('close', () => { this.closed = true; });
    stream.stderr && stream.stderr.on('data', () => {}); // PTY merges stderr; drain just in case
  }

  // Swallow the login banner/MOTD and put the shell into a clean, quiet state.
  init() {
    return new Promise((resolve, reject) => {
      const readyTok = `${this.marker}:READY`;
      let acc = '';
      const onData = (chunk) => {
        acc += chunk.toString('utf8');
        if (acc.includes(readyTok)) {
          this.stream.removeListener('data', onData);
          this.buf = '';
          resolve();
        }
      };
      this.stream.on('data', onData);
      const t = setTimeout(() => {
        this.stream.removeListener('data', onData);
        reject(new Error('RemoteShell init timed out'));
      }, RPC_DEFAULT_TIMEOUT_MS);
      t.unref && t.unref();
      // Quiet the shell: no echo, no prompt, no prompt-command noise.
      // The PTY echoes this command line back before `stty -echo` takes effect,
      // so emit the ready token in two pieces (`…:RE` + `ADY`) — the echoed
      // command never contains the full token, so we only match the real output.
      const a = shq(`${this.marker}:RE`);
      const b = shq('ADY');
      this.stream.write(
        `stty -echo 2>/dev/null; export PS1=''; export PS2=''; export PROMPT_COMMAND=''; ` +
        `unset HISTFILE; printf '%s%s\\n' ${a} ${b}\n`
      );
    });
  }

  // Run a command; resolve { stdout, code }. Serialized so only one runs at a time.
  run(command, { timeout = RPC_DEFAULT_TIMEOUT_MS } = {}) {
    this.queue = this.queue.then(() => this._exec(command, timeout));
    return this.queue;
  }

  _exec(command, timeout) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('RemoteShell channel closed'));
      const onData = (chunk) => {
        this.buf += chunk.toString('utf8');
        if (this.buf.length > RPC_MAX_OUTPUT) {
          cleanup();
          return reject(new Error('command output exceeded limit'));
        }
        const m = this.buf.match(this.endRe);
        if (m) {
          cleanup();
          const code = parseInt(m[1], 10);
          // PTY output maps \n → \r\n; strip the \r so parsing/filenames stay clean.
          let stdout = this.buf.slice(0, m.index).replace(/\r/g, '');
          // Drop the newline we injected just before the marker.
          if (stdout.endsWith('\n')) stdout = stdout.slice(0, -1);
          this.buf = '';
          resolve({ stdout, code });
        }
      };
      const onClose = () => { cleanup(); reject(new Error('RemoteShell channel closed mid-command')); };
      const cleanup = () => {
        clearTimeout(timer);
        this.stream.removeListener('data', onData);
        this.stream.removeListener('close', onClose);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('command timed out')); }, timeout);
      timer.unref && timer.unref();

      this.buf = '';
      this.stream.on('data', onData);
      this.stream.on('close', onClose);
      // Run the command, then emit the marker + exit code. No leading newline:
      // the marker regex matches anywhere, and an injected \n would double up
      // with the command's own trailing newline.
      this.stream.write(`${command}\nprintf '%s:%s:EOF\\n' ${shq(this.marker)} "$?"\n`);
    });
  }

  // ── File/info helpers (all over run()) ──

  async list(dir) {
    const d = dir || '.';
    // GNU find -printf: type<TAB>size<TAB>mtime<TAB>name
    const { stdout, code } = await this.run(
      `find ${shq(d)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%TY-%Tm-%Td %TH:%TM\\t%f\\n' 2>&1`
    );
    if (code !== 0) throw new Error(stdout.trim() || `cannot list ${d}`);
    const entries = stdout.split('\n').filter(Boolean).map(line => {
      const [type, size, mtime, ...nameParts] = line.split('\t');
      const name = nameParts.join('\t');
      return { name, isDir: type === 'd', size: Number(size) || 0, mtime };
    }).filter(e => e.name);
    entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    return { path: d, entries };
  }

  async readFile(remotePath) {
    const sz = await this.run(`stat -c %s -- ${shq(remotePath)} 2>&1`);
    if (sz.code !== 0) throw new Error(sz.stdout.trim() || `cannot stat ${remotePath}`);
    const size = Number(sz.stdout.trim());
    if (Number.isFinite(size) && size > FILE_READ_CAP) {
      throw new Error(`file too large (${size} bytes; cap ${FILE_READ_CAP})`);
    }
    const { stdout, code } = await this.run(`base64 -w0 -- ${shq(remotePath)} 2>&1`, { timeout: 60000 });
    if (code !== 0) throw new Error(stdout.trim() || `cannot read ${remotePath}`);
    return Buffer.from(stdout.replace(/\s/g, ''), 'base64');
  }

  async writeFile(remotePath, buf) {
    // Wrap base64 at 1000 chars/line: PTY canonical-mode input caps line length
    // (~4096 bytes), and `base64 -d` ignores the newlines on the way back in.
    const b64 = Buffer.from(buf).toString('base64').replace(/(.{1000})/g, '$1\n');
    const heredoc = `B64_${this.marker}`;
    // Stream base64 in via a quoted heredoc so arbitrary content can't break out.
    const cmd = `base64 -d > ${shq(remotePath)} <<'${heredoc}'\n${b64}\n${heredoc}`;
    const { stdout, code } = await this.run(cmd, { timeout: 60000 });
    if (code !== 0) throw new Error(stdout.trim() || `cannot write ${remotePath}`);
  }

  async deletePath(remotePath) {
    const { stdout, code } = await this.run(`rm -rf -- ${shq(remotePath)} 2>&1`);
    if (code !== 0) throw new Error(stdout.trim() || `cannot delete ${remotePath}`);
  }
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

/**
 * OTP mode: return the ready RemoteShell RPC channel, or throw NOT_CONNECTED.
 */
function acquireRpc(id) {
  const s = sessions.get(id);
  if (s && s.status === 'ready' && s.rpc) {
    resetIdle(id);
    return s.rpc;
  }
  const err = new Error('NOT_CONNECTED');
  err.code = 'NOT_CONNECTED';
  throw err;
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
    rpc: null,
  };
  sessions.set(id, session);

  if (mode === 'otp') {
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      if (prompts.length === 0) { finish([]); return; }   // info-only round
      session.status = 'awaiting_otp';
      session.otpFinish = finish;
      const promptText = prompts[0].prompt || 'OTP:';
      sse('prompt', { prompt: promptText });
    });
  } else if (server.auth_type !== 'key') {
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(prompts.map(() => decrypt(server.password)));
    });
  }

  conn.on('ready', () => {
    session.otpFinish = null;
    if (mode === 'otp') {
      // The gateway grants only ONE channel and only an interactive shell, so
      // open that single shell now and drive it as an RPC channel for the whole
      // session (file ops, sysinfo, command console all flow through it).
      conn.shell({ term: 'dumb' }, (err, stream) => {
        if (err) {
          console.error(`[ssh] shell open failed for server ${id}: ${err.message}`);
          sse('error', { message: `Shell channel failed: ${err.message}` });
          clearSession(id);
          res.end();
          return;
        }
        const marker = 'RT_' + crypto.randomBytes(8).toString('hex');
        const rpc = new RemoteShell(stream, marker);
        rpc.init().then(() => {
          session.rpc = rpc;
          session.status = 'ready';
          session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
          sse('connected', { serverId: id });
          res.end();
        }).catch((e) => {
          console.error(`[ssh] RemoteShell init failed for server ${id}: ${e.message}`);
          sse('error', { message: `Session init failed: ${e.message}` });
          clearSession(id);
          res.end();
        });
      });
      return;
    }
    session.status = 'ready';
    session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
    sse('connected', { serverId: id });
    res.end();
  });

  conn.on('error', (err) => {
    console.error(`[ssh] connect error for server ${id} (${server.host}) [mode=${mode}]: level=${err.level || 'n/a'} message=${err.message}`);
    sse('error', { message: err.message });
    sessions.delete(id);
    res.end();
  });

  conn.on('close', () => {
    if (sessions.get(id) === session) sessions.delete(id);
  });

  const config = sshConfig(server, mode);
  if (mode === 'otp') {
    // Tunnel through the zero-trust proxy — the gateway is only reachable via it.
    connectViaProxy(server.host, server.port || 22)
      .then((sock) => { config.sock = sock; conn.connect(config); })
      .catch((err) => {
        console.error(`[ssh] proxy tunnel failed for server ${id} (${server.host}): ${err.message}`);
        sse('error', { message: `Zero-trust proxy tunnel failed: ${err.message}` });
        sessions.delete(id);
        res.end();
      });
  } else {
    conn.connect(config);
  }

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

  // OTP mode: the gateway refuses exec channels — run via the shared shell RPC.
  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message })}\n\n`);
      res.end();
      return;
    }
    try {
      const { stdout, code } = await rpc.run(cmd, { timeout: 120000 });
      if (stdout) res.write(`data: ${JSON.stringify({ type: 'stdout', data: stdout })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: e.message })}\n\n`);
    }
    res.end();
    return;
  }

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

function parseSysInfo(out) {
  const info = {};
  out.split('\n').forEach(line => {
    const i = line.indexOf('=');
    if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim();
  });
  return info;
}

const SYSINFO_SCRIPT = [
  'echo "HOST=$(hostname 2>/dev/null)"',
  '. /etc/os-release 2>/dev/null; echo "OS=${PRETTY_NAME:-$(uname -s)}"',
  'echo "KERNEL=$(uname -r)"',
  'echo "ARCH=$(uname -m)"',
  'echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"',
  'echo "CPUS=$(nproc 2>/dev/null)"',
  'echo "LOAD=$(awk \'{print $1,$2,$3}\' /proc/loadavg 2>/dev/null)"',
  'MU=$(free -m 2>/dev/null | grep "^Mem:" | awk "{print \\$3}"); MT=$(free -m 2>/dev/null | grep "^Mem:" | awk "{print \\$2}"); echo "MEM=${MU}/${MT}"',
  'DU=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$3}"); DT=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$2}"); DP=$(df -h / 2>/dev/null | tail -1 | awk "{print \\$5}"); echo "DISK=${DU}/${DT} (${DP})"',
].join('; ');

app.get('/api/servers/:id/sysinfo', async (req, res) => {
  const id = +req.params.id;

  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) { return res.status(409).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : err.message }); }
    try {
      const { stdout } = await rpc.run(SYSINFO_SCRIPT);
      return res.json(parseSysInfo(stdout));
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let conn;
  try { conn = await acquire(id); }
  catch (err) {
    return res.status(409).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : err.message });
  }

  conn.exec(SYSINFO_SCRIPT, (err, stream) => {
    if (err) return res.status(500).json({ error: err.message });
    let out = '';
    stream.on('data', d => { out += d.toString(); });
    stream.stderr.on('data', () => {}); // drain stderr
    stream.on('close', () => { res.json(parseSysInfo(out)); });
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

  // OTP mode: gateway refuses sftp — write via the shared shell (base64).
  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) {
      fs.unlink(localPath, () => {});
      return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
    }
    try {
      const buf = fs.readFileSync(localPath);
      await rpc.writeFile(remotePath, buf);
      fs.unlink(localPath, () => {});
      return res.json({ ok: true });
    } catch (e) {
      fs.unlink(localPath, () => {});
      return res.status(500).json({ error: e.message });
    }
  }

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

  const remotePath = req.body.path;

  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      const buf = await rpc.readFile(remotePath);
      return res.json({ content: buf.toString('utf8') });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

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

  const { path: remotePath, content } = req.body;

  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      await rpc.writeFile(remotePath, Buffer.from(content ?? '', 'utf8'));
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

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

  const dirPath = req.body.path;

  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      const result = await rpc.list(dirPath);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

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

  const filePath = req.body.path;

  if (getAuthMode() === 'otp') {
    let rpc;
    try { rpc = acquireRpc(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      await rpc.deletePath(filePath);
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let conn;
  try {
    conn = await acquire(id);
  } catch (err) {
    return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
  }

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

  // OTP mode: the single allowed channel is owned by the RPC shell, so a live
  // PTY isn't available — the UI uses the command console instead.
  if (getAuthMode() === 'otp') {
    ws.send(JSON.stringify({ type: 'error', message: 'Live terminal is unavailable over the zero-trust gateway. Use the command console.' }));
    ws.close();
    return;
  }

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
