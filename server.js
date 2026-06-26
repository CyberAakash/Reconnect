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
// `otp` controls only the auth handshake (independent of transport): when true,
// ssh2 is driven straight to keyboard-interactive so the user can type a passcode.
// Transport (config.sock for the proxy tunnel) is set by the caller.
function sshConfig(server, { otp } = {}) {
  const config = {
    host: server.host,
    port: server.port,
    username: server.username,
    // Keep idle sessions alive (the zero-trust gateway/NAT drops silent
    // connections). Ping every 15s; give up after ~2 min of no reply.
    keepaliveInterval: 15000,
    keepaliveCountMax: 8,
  };
  if (otp) {
    // OTP flow: authenticate via a single one-time passcode over
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

  // ── File/info helpers — delegate to the runner-agnostic b64* helpers so the
  //    exact same shell logic backs both the internal RPC shell and the
  //    external direct-exec path (see b64List/b64ReadFile/... below). ──
  list(dir)                   { return b64List(this.runner, dir); }
  readFile(remotePath)        { return b64ReadFile(this.runner, remotePath); }
  writeFile(remotePath, buf)  { return b64WriteFile(this.runner, remotePath, buf); }
  deletePath(remotePath)      { return b64DeletePath(this.runner, remotePath); }

  // Bound `run` so helpers can call it like a plain function.
  get runner() { return (cmd, opts) => this.run(cmd, opts); }
}

// ════════════════════════════════════════
//  ONE-CHANNEL (base64-over-shell) FILE OPS
// ════════════════════════════════════════
//
// These back the 'onechannel' explorer mode. A `run(cmd, {timeout}) =>
// { stdout, code }` runner abstracts *how* the command reaches the host:
//   • internal transport → the persistent single-shell RPC (RemoteShell.run)
//   • external transport → a fresh `conn.exec()` per call (execRunner)
// All paths are POSIX-quoted via shq() — never interpolate raw user paths.

async function b64List(run, dir) {
  const d = dir || '.';
  // GNU find -printf: type<TAB>size<TAB>mtime<TAB>name
  const { stdout, code } = await run(
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

async function b64ReadFile(run, remotePath) {
  const sz = await run(`stat -c %s -- ${shq(remotePath)} 2>&1`);
  if (sz.code !== 0) throw new Error(sz.stdout.trim() || `cannot stat ${remotePath}`);
  const size = Number(sz.stdout.trim());
  if (Number.isFinite(size) && size > FILE_READ_CAP) {
    throw new Error(`file too large (${size} bytes; cap ${FILE_READ_CAP})`);
  }
  const { stdout, code } = await run(`base64 -w0 -- ${shq(remotePath)} 2>&1`, { timeout: 60000 });
  if (code !== 0) throw new Error(stdout.trim() || `cannot read ${remotePath}`);
  return Buffer.from(stdout.replace(/\s/g, ''), 'base64');
}

async function b64WriteFile(run, remotePath, buf) {
  // Wrap base64 at 1000 chars/line: PTY canonical-mode input caps line length
  // (~4096 bytes), and `base64 -d` ignores the newlines on the way back in.
  const b64 = Buffer.from(buf).toString('base64').replace(/(.{1000})/g, '$1\n');
  const heredoc = `B64_${crypto.randomBytes(8).toString('hex')}`;
  // Stream base64 in via a quoted heredoc so arbitrary content can't break out.
  const cmd = `base64 -d > ${shq(remotePath)} <<'${heredoc}'\n${b64}\n${heredoc}`;
  const { stdout, code } = await run(cmd, { timeout: 60000 });
  if (code !== 0) throw new Error(stdout.trim() || `cannot write ${remotePath}`);
}

async function b64DeletePath(run, remotePath) {
  const { stdout, code } = await run(`rm -rf -- ${shq(remotePath)} 2>&1`);
  if (code !== 0) throw new Error(stdout.trim() || `cannot delete ${remotePath}`);
}

// Build a one-shot `run()` over a live (external) SSH connection: each call is
// its own `exec` channel, so the exit code comes from the channel close event —
// no sentinel marker needed (unlike the persistent PTY RemoteShell).
function execRunner(conn) {
  return (command, { timeout = RPC_DEFAULT_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let done = false;
      const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
      const timer = setTimeout(() => { try { stream.close(); } catch (_) {} finish(reject, new Error('command timed out')); }, timeout);
      timer.unref && timer.unref();
      stream.on('data', (d) => {
        stdout += d.toString('utf8');
        if (stdout.length > RPC_MAX_OUTPUT) { try { stream.close(); } catch (_) {} finish(reject, new Error('command output exceeded limit')); }
      });
      // Commands already redirect 2>&1 where they want stderr; drain anything else.
      stream.stderr.on('data', (d) => { stdout += d.toString('utf8'); });
      stream.on('close', (code) => finish(resolve, { stdout, code: typeof code === 'number' ? code : 0 }));
      stream.on('error', (e) => finish(reject, e));
    });
  });
}

// Probe whether a connection's gateway permits an exec channel. Resolves true if
// a trivial `printf` exec runs cleanly, false on any error/timeout. Used once at
// connect time to decide internal transport's op mode (exec vs single shell).
function probeExec(conn) {
  // Escape hatch: force the legacy single-shell RPC path (e.g. if a gateway
  // accepts the probe but misbehaves on later exec channels).
  if (process.env.RECONNECT_FORCE_SINGLE_SHELL === '1') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(false), 4000);
    t.unref && t.unref();
    try {
      conn.exec('printf RT_OK', (err, stream) => {
        if (err) return done(false);
        let out = '';
        stream.on('data', (d) => { out += d.toString('utf8'); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => done(out.includes('RT_OK')));
        stream.on('error', () => done(false));
      });
    } catch (_) { done(false); }
  });
}

// ════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════

// ── Generic settings access ──
function getSetting(key, fallback) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : fallback;
}
// Global default for an axis ('connection_method' | 'auth_mode' | 'explorer_mode' | 'terminal_mode').
function getDefault(axis, fallback) {
  return getSetting(`default_${axis}`, fallback);
}

// Configuration scope ('global' = the four global defaults rule every server |
// 'standalone' = each server uses its own stored axis values). Generalizes the
// old per-axis `auth_scope`; reads config_scope, falling back to auth_scope.
function getConfigScope() {
  return getSetting('config_scope', getSetting('auth_scope', 'global'));
}
// Back-compat alias for the auth axis (kept in sync with config_scope on save).
function getAuthScope() { return getConfigScope(); }
function getAuthMode()  { return getDefault('auth_mode', getSetting('auth_mode', 'otp')); }

// Resolve one axis honoring scope: the server's own value under 'standalone',
// otherwise the global default. `col` is from a fixed internal whitelist.
function resolveAxis(serverId, col, fallback) {
  if (getConfigScope() === 'standalone') {
    const row = db.prepare(`SELECT ${col} FROM servers WHERE id=?`).get(serverId);
    if (row && row[col]) return row[col];
  }
  return getDefault(col, fallback);
}

// Transport ('internal' = via zero-trust proxy + single-shell RPC; 'external' = direct SSH).
function getConnectionMethod(serverId) {
  return resolveAxis(serverId, 'connection_method', 'internal') === 'external' ? 'external' : 'internal';
}
function isInternal(serverId) {
  return getConnectionMethod(serverId) === 'internal';
}

// Effective auth flow for a server.
function resolveAuthMode(serverId) {
  return resolveAxis(serverId, 'auth_mode', 'otp') === 'password' ? 'password' : 'otp';
}

// OTP is only honored for internal (gateway) hosts; external hosts always use password/key.
function usesOtp(serverId) {
  return isInternal(serverId) && resolveAuthMode(serverId) === 'otp';
}

// Effective explorer/terminal modes. The only hard feasibility downgrade left
// is the EXPLORER on internal transport: the zero-trust gateway blocks the SFTP
// subsystem (the ZAC doc requires `scp -O`), so SFTP falls back to one-channel
// (base64-over-exec). A live PTY *does* work over the gateway (a plain `ssh` is
// a full interactive shell), so the terminal axis is no longer downgraded.
// Returns { mode, requested, downgraded }.
function effectiveExplorerMode(serverId) {
  const requested = resolveAxis(serverId, 'explorer_mode', 'onechannel') === 'sftp' ? 'sftp' : 'onechannel';
  const downgraded = isInternal(serverId) && requested === 'sftp';
  return { mode: downgraded ? 'onechannel' : requested, requested, downgraded };
}
function effectiveTerminalMode(serverId) {
  const mode = resolveAxis(serverId, 'terminal_mode', 'console') === 'pty' ? 'pty' : 'console';
  return { mode, requested: mode, downgraded: false };
}

function dropAllSessions() {
  for (const [, session] of sessions) {
    clearTimeout(session.idleTimer);
    try { session.conn.end(); } catch (_) {}
  }
  sessions.clear();
}

// Allowed values per settings key, used by both the GET shape and PUT validation.
const SETTING_ENUMS = {
  config_scope:              ['global', 'standalone'],
  default_connection_method: ['internal', 'external'],
  default_auth_mode:         ['password', 'otp'],
  default_explorer_mode:     ['sftp', 'onechannel'],
  default_terminal_mode:     ['pty', 'console'],
};

function settingsShape() {
  return {
    config_scope:              getConfigScope(),
    default_connection_method: getDefault('connection_method', 'internal'),
    default_auth_mode:         getDefault('auth_mode', 'otp'),
    default_explorer_mode:     getDefault('explorer_mode', 'onechannel'),
    default_terminal_mode:     getDefault('terminal_mode', 'console'),
    // Legacy aliases (kept so older clients keep working).
    auth_mode:  getAuthMode(),
    auth_scope: getConfigScope(),
  };
}

app.get('/api/settings', (req, res) => {
  res.json(settingsShape());
});

app.put('/api/settings', (req, res) => {
  const body = { ...req.body };
  // Accept legacy aliases by mapping them onto the canonical keys.
  if (body.auth_scope !== undefined && body.config_scope === undefined) body.config_scope = body.auth_scope;
  if (body.auth_mode  !== undefined && body.default_auth_mode === undefined) body.default_auth_mode = body.auth_mode;

  // Validate every provided key against its enum before writing anything.
  for (const [key, allowed] of Object.entries(SETTING_ENUMS)) {
    if (body[key] !== undefined && !allowed.includes(body[key])) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  const write = (key, val) => { if (val !== undefined) db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, val); };
  for (const key of Object.keys(SETTING_ENUMS)) write(key, body[key]);
  // Keep the legacy keys in sync so getAuthScope()/getAuthMode() back-compat holds.
  if (body.config_scope !== undefined)      write('auth_scope', body.config_scope);
  if (body.default_auth_mode !== undefined) write('auth_mode',  body.default_auth_mode);

  // Drop all pooled sessions so each server re-auths under the new effective config.
  dropAllSessions();
  res.json({ ok: true, ...settingsShape() });
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

    conn.connect(sshConfig(server, { otp: false }));
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
 * Route-level helper for EXTERNAL (direct) servers — auto-pooled password/key
 * connection. Internal servers never reach here; their callers use
 * internalRunner() after an explicit Connect (proxy tunnel + exec/single shell).
 */
async function acquire(id) {
  return ensureSession(id);
}

/**
 * Return a `run(cmd, {timeout}) => { stdout, code }` runner for an INTERNAL
 * server's pooled (proxy-tunneled) connection: clean per-op exec channels when
 * the gateway allows exec (session.execMode), else the persistent single-shell
 * RPC. Throws NOT_CONNECTED until the user has connected.
 */
function internalRunner(id) {
  const s = sessions.get(id);
  if (s && s.status === 'ready') {
    resetIdle(id);
    if (s.execMode) return execRunner(s.conn);
    if (s.rpc) return (cmd, opts) => s.rpc.run(cmd, opts);
  }
  const err = new Error('NOT_CONNECTED');
  err.code = 'NOT_CONNECTED';
  throw err;
}

/**
 * Return a `run(cmd, {timeout}) => { stdout, code }` runner for the one-channel
 * (base64-over-shell/exec) file ops, picking the right backing channel for the
 * server's transport: internalRunner for internal hosts (exec or single-shell),
 * or a fresh-exec runner over the pooled direct connection for external hosts.
 * Throws NOT_CONNECTED (internal) / connection errors (external) like its peers.
 */
async function acquireB64Runner(id) {
  if (isInternal(id)) return internalRunner(id);
  const conn = await acquire(id);
  return execRunner(conn);
}

// ════════════════════════════════════════
//  SERVER CRUD
// ════════════════════════════════════════

app.get('/api/servers', (req, res) => {
  const servers = db.prepare('SELECT id, label, host, port, username, auth_type, key_path, auth_mode, connection_method, explorer_mode, terminal_mode FROM servers ORDER BY label').all();
  // Annotate each server with its effective (scope- + feasibility-resolved) axes
  // so the UI can gate behavior and flag downgrades without re-deriving the rules.
  for (const s of servers) {
    if (!s.auth_mode) s.auth_mode = 'otp';
    if (s.connection_method !== 'external') s.connection_method = 'internal';
    if (!s.explorer_mode) s.explorer_mode = 'onechannel';
    if (!s.terminal_mode) s.terminal_mode = 'console';
    const exp = effectiveExplorerMode(s.id);
    const term = effectiveTerminalMode(s.id);
    s.effective_connection_method = getConnectionMethod(s.id);
    s.effective_auth_mode = resolveAuthMode(s.id);
    s.effective_explorer_mode = exp.mode;
    s.effective_terminal_mode = term.mode;
    s.explorer_downgraded = exp.downgraded;
    s.terminal_downgraded = term.downgraded;
  }
  res.json(servers);
});

// Normalize the four per-server axes from a request body.
const normMethod   = (v) => (v === 'external'   ? 'external'   : 'internal');
const normAuth     = (v) => (v === 'password'   ? 'password'   : 'otp');
const normExplorer = (v) => (v === 'sftp'       ? 'sftp'       : 'onechannel');
const normTerminal = (v) => (v === 'pty'        ? 'pty'        : 'console');

app.post('/api/servers', (req, res) => {
  const { label, host, port, username, auth_type, password, key_path, auth_mode, connection_method, explorer_mode, terminal_mode } = req.body;
  const encPass = auth_type === 'password' ? encrypt(password) : '';
  const info = db.prepare('INSERT INTO servers (label, host, port, username, auth_type, password, key_path, auth_mode, connection_method, explorer_mode, terminal_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(label, host, port || 22, username, auth_type || 'password', encPass, key_path || '', normAuth(auth_mode), normMethod(connection_method), normExplorer(explorer_mode), normTerminal(terminal_mode));
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/servers/:id', (req, res) => {
  const { label, host, port, username, auth_type, password, key_path, auth_mode, connection_method, explorer_mode, terminal_mode } = req.body;
  const mode = normAuth(auth_mode);
  const method = normMethod(connection_method);
  const exp = normExplorer(explorer_mode);
  const term = normTerminal(terminal_mode);
  const encPass = auth_type === 'password' && password ? encrypt(password) : undefined;
  if (encPass !== undefined) {
    db.prepare('UPDATE servers SET label=?, host=?, port=?, username=?, auth_type=?, password=?, key_path=?, auth_mode=?, connection_method=?, explorer_mode=?, terminal_mode=? WHERE id=?')
      .run(label, host, port || 22, username, auth_type, encPass, key_path || '', mode, method, exp, term, req.params.id);
  } else {
    db.prepare('UPDATE servers SET label=?, host=?, port=?, username=?, auth_type=?, key_path=?, auth_mode=?, connection_method=?, explorer_mode=?, terminal_mode=? WHERE id=?')
      .run(label, host, port || 22, username, auth_type, key_path || '', mode, method, exp, term, req.params.id);
  }
  // Drop pooled session so next op re-connects with new creds / flow / transport
  clearSession(+req.params.id);
  res.json({ ok: true });
});

// Quick per-server axis toggles (overview inline controls). One handler per axis,
// each validating its enum and dropping the pooled session so the next op
// re-resolves under the new value.
function axisPatch(col, allowed) {
  return (req, res) => {
    const val = req.body[col];
    if (!allowed.includes(val)) return res.status(400).json({ error: `Invalid ${col}` });
    const info = db.prepare(`UPDATE servers SET ${col}=? WHERE id=?`).run(val, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Server not found' });
    clearSession(+req.params.id);
    res.json({ ok: true, [col]: val });
  };
}
app.put('/api/servers/:id/auth-mode',         (req, res) => axisPatch('auth_mode',         ['password', 'otp'])(req, res));
app.put('/api/servers/:id/connection-method', (req, res) => axisPatch('connection_method', ['internal', 'external'])(req, res));
app.put('/api/servers/:id/explorer-mode',     (req, res) => axisPatch('explorer_mode',     ['sftp', 'onechannel'])(req, res));
app.put('/api/servers/:id/terminal-mode',     (req, res) => axisPatch('terminal_mode',     ['pty', 'console'])(req, res));

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
  // Internal hosts need an explicit Connect (proxy tunnel + single shell); just
  // report the current session status. External hosts can be probed by connecting.
  if (isInternal(id)) {
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

  // Two independent decisions:
  //   internal  → tunnel through the zero-trust proxy + single-shell RPC
  //   usesOtp   → prompt the user for a one-time passcode (internal + otp only)
  const internal = isInternal(id);
  const otp = usesOtp(id);

  // The gateway blocks the SFTP subsystem, so an SFTP explorer choice on an
  // internal host falls back to one-channel (base64). Surface it up front.
  if (effectiveExplorerMode(id).downgraded) {
    sse('notice', { message: 'Internal transport: the gateway blocks SFTP — using one-channel file access (base64).' });
  }
  const conn = new Client();
  const session = {
    conn,
    status: 'connecting',
    otpFinish: null,
    idleTimer: null,
    connectResolvers: [],
    rpc: null,       // RemoteShell when in single-shell fallback mode
    execMode: false, // true once the gateway is confirmed to allow exec channels
  };
  sessions.set(id, session);

  if (otp) {
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      if (prompts.length === 0) { finish([]); return; }   // info-only round
      session.status = 'awaiting_otp';
      session.otpFinish = finish;
      const promptText = prompts[0].prompt || 'OTP:';
      sse('prompt', { prompt: promptText });
    });
  } else if (server.auth_type !== 'key') {
    // internal+password or external+password: finish keyboard-interactive
    // silently with the stored password (no prompt).
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(prompts.map(() => decrypt(server.password)));
    });
  }

  conn.on('ready', () => {
    session.otpFinish = null;
    if (internal) {
      // Historically the zero-trust gateway granted only ONE interactive-shell
      // channel (no exec/sftp), so every op was driven through a single shell
      // RPC. Newer gateways allow exec channels (only the SFTP subsystem stays
      // blocked). Probe for exec: if it works, run ops over clean per-op exec
      // channels (native exit codes, no banner-swallowing); otherwise fall back
      // to the single-shell RPC exactly as before.
      const markReady = (msg) => {
        session.status = 'ready';
        session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
        if (msg) sse('notice', { message: msg });
        sse('connected', { serverId: id });
        res.end();
      };
      const openRpcShell = () => {
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
            markReady(null);
          }).catch((e) => {
            console.error(`[ssh] RemoteShell init failed for server ${id}: ${e.message}`);
            sse('error', { message: `Session init failed: ${e.message}` });
            clearSession(id);
            res.end();
          });
        });
      };
      // OTP mode always uses single-shell RPC; skip exec probe to avoid interference
      // with keyboard-interactive during auth. Non-OTP modes can probe for exec.
      if (otp) {
        console.log(`[ssh] server ${id}: OTP mode — using single-shell RPC`);
        openRpcShell();
      } else {
        probeExec(conn).then((execOk) => {
          if (sessions.get(id) !== session) return; // disconnected meanwhile
          if (execOk) {
            session.execMode = true;
            console.log(`[ssh] server ${id}: gateway allows exec — using exec mode`);
            markReady('Connected — gateway allows exec channels (fast mode: clean output, native exit codes).');
          } else {
            console.log(`[ssh] server ${id}: exec refused — using single-shell RPC`);
            openRpcShell();
          }
        });
      }
      return;
    }
    session.status = 'ready';
    session.idleTimer = setTimeout(() => clearSession(id), IDLE_TIMEOUT_MS);
    sse('connected', { serverId: id });
    res.end();
  });

  conn.on('error', (err) => {
    console.error(`[ssh] connect error for server ${id} (${server.host}) [method=${internal ? 'internal' : 'external'} otp=${otp}]: level=${err.level || 'n/a'} message=${err.message}`);
    sse('error', { message: err.message });
    sessions.delete(id);
    res.end();
  });

  conn.on('close', () => {
    if (sessions.get(id) === session) sessions.delete(id);
  });

  const config = sshConfig(server, { otp });
  if (internal) {
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

  // Internal transport: run over the pooled connection — exec channel when the
  // gateway allows it, else the shared single-shell RPC (internalRunner picks).
  if (isInternal(id)) {
    let run;
    try { run = internalRunner(id); }
    catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', data: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message })}\n\n`);
      res.end();
      return;
    }
    try {
      const { stdout, code } = await run(cmd, { timeout: 120000 });
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

  if (isInternal(id)) {
    let run;
    try { run = internalRunner(id); }
    catch (err) { return res.status(409).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : err.message }); }
    try {
      const { stdout } = await run(SYSINFO_SCRIPT);
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

  // One-channel explorer: write via base64-over-shell (RPC for internal, exec
  // for external) — no SFTP subsystem needed.
  if (effectiveExplorerMode(id).mode === 'onechannel') {
    let run;
    try { run = await acquireB64Runner(id); }
    catch (err) {
      fs.unlink(localPath, () => {});
      return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message });
    }
    try {
      const buf = fs.readFileSync(localPath);
      await b64WriteFile(run, remotePath, buf);
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

  if (effectiveExplorerMode(id).mode === 'onechannel') {
    let run;
    try { run = await acquireB64Runner(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      const buf = await b64ReadFile(run, remotePath);
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

  if (effectiveExplorerMode(id).mode === 'onechannel') {
    let run;
    try { run = await acquireB64Runner(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      await b64WriteFile(run, remotePath, Buffer.from(content ?? '', 'utf8'));
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

  if (effectiveExplorerMode(id).mode === 'onechannel') {
    let run;
    try { run = await acquireB64Runner(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      const result = await b64List(run, dirPath);
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

  if (effectiveExplorerMode(id).mode === 'onechannel') {
    let run;
    try { run = await acquireB64Runner(id); }
    catch (err) { return res.status(503).json({ error: err.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED: click Connect first' : err.message }); }
    try {
      await b64DeletePath(run, filePath);
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

  // A live PTY is only served when the effective terminal mode is 'pty'.
  if (effectiveTerminalMode(id).mode !== 'pty') {
    ws.send(JSON.stringify({ type: 'error', message: 'This server is set to command-panel mode. Switch its Terminal to Live PTY to use an interactive shell.' }));
    ws.close();
    return;
  }

  // Internal hosts open the PTY shell channel on the EXISTING proxy-tunneled,
  // already-authenticated session (a plain interactive shell works over the
  // gateway). External hosts auto-pool a direct connection. Reusing the pooled
  // internal conn is essential — acquire()/ensureSession would open a NEW direct
  // connection that bypasses the zero-trust proxy.
  let conn;
  if (isInternal(id)) {
    const s = sessions.get(id);
    if (!s || s.status !== 'ready') {
      ws.send(JSON.stringify({ type: 'error', message: 'NOT_CONNECTED: click Connect first' }));
      ws.close();
      return;
    }
    resetIdle(id);
    conn = s.conn;
  } else {
    try {
      conn = await acquire(id);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
      return;
    }
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
