import { STATE, effectiveTerminalMode } from '../state.js';
import { ensureWterm } from '../wterm.js';
import { applyTerminalTheme } from '../theme.js';

// Injected at runtime to break circular deps
let _deps = {};
export function _setTerminalDeps(deps) { Object.assign(_deps, deps); }

export function teardownTerminal() {
  if (STATE.termWs) { STATE.termWs.close(); STATE.termWs = null; }
  if (STATE.termConsoleSse) { try { STATE.termConsoleSse.close(); } catch {} STATE.termConsoleSse = null; }
  // Tear down the OTP DOM command console (if any) and restore the xterm host.
  if (STATE._termConsoleEls) {
    try { STATE._termConsoleEls.out?.remove(); STATE._termConsoleEls.inputRow?.remove(); } catch {}
    STATE._termConsoleEls = null;
  }
  const xtermHost = document.getElementById('term-xterm');
  if (xtermHost) xtermHost.style.display = '';
  STATE.termConsole = false;
  STATE._consoleExternal = null;
  if (STATE.xtermInst) { STATE.xtermInst.destroy(); STATE.xtermInst = null; }
}

export function parkTerminal() {
  try { STATE.xtermInst?.resizeObserver?.disconnect(); } catch {}
}

export function unparkTerminal() {
  // OTP DOM console: just refocus the input.
  if (STATE.termConsole) {
    requestAnimationFrame(() => { try { STATE._termConsoleEls?.input?.focus(); } catch {} });
    return;
  }
  const t = STATE.xtermInst;
  if (!t || !t.resizeObserver || !t.element) return;
  try {
    t.resizeObserver.disconnect();
    t.resizeObserver.observe(t.element);
  } catch {}
  requestAnimationFrame(() => { try { t.focus(); } catch {} });
}

export function refitTerminal() {
  if (STATE.termConsole) {
    const out = STATE._termConsoleEls?.out;
    if (out) out.scrollTop = out.scrollHeight;
    return;
  }
  const t = STATE.xtermInst;
  if (!t || !t.resizeObserver || !t.element) return;
  if (STATE.centerTab !== 'terminal') return;
  try {
    t.element.scrollTop = t.element.scrollHeight;
    t.resizeObserver.disconnect();
    t.resizeObserver.observe(t.element);
  } catch {}
}

export function refreshTerminal() {
  const id = STATE.selectedId;
  if (!id) return;
  // OTP DOM console: clear the output area.
  if (STATE.termConsole) {
    const out = STATE._termConsoleEls?.out;
    if (out) out.innerHTML = '';
    unparkTerminal();
    return;
  }
  const ws = STATE.termWs;
  const alive = ws && ws.readyState === WebSocket.OPEN && STATE.xtermInst;
  if (alive) {
    try { STATE.xtermInst.write('\x1b[2J\x1b[3J\x1b[H'); } catch {}
    try { ws.send('\x0c'); } catch {}
    refitTerminal();
    unparkTerminal();
  } else {
    updateTerminalState(id);
    unparkTerminal();
  }
}

export function updateTerminalState(id) {
  if (STATE.centerTab !== 'terminal') return;
  const status   = STATE.serverStatus[id] || 'disconnected';
  const disView  = document.getElementById('term-disconnected');
  const replView = document.getElementById('term-repl');
  if (status === 'connected') {
    disView.style.display  = 'none';
    replView.style.display = 'flex';
    if (effectiveTerminalMode(id) !== 'pty') {
      // DOM command console: alive as long as it's built for this server.
      if (!STATE.termConsole || STATE._termServerId !== id || !STATE._termConsoleEls) {
        STATE._termServerId = id;
        buildCommandConsole(id);
      }
    } else {
      const _ws = STATE.termWs;
      const _dead = !_ws || _ws.readyState === WebSocket.CLOSING || _ws.readyState === WebSocket.CLOSED;
      if (!STATE.xtermInst || STATE._termServerId !== id || _dead) {
        STATE._termServerId = id;
        buildTerminal(id);
      }
    }
  } else {
    teardownTerminal();
    STATE._termServerId = null;
    disView.style.display  = 'flex';
    replView.style.display = 'none';
    document.getElementById('term-dis-msg').textContent =
      status === 'connecting' ? 'Connecting…' : 'Open an SSH session to run commands.';
    document.getElementById('term-connect-btn').onclick = () => _deps.connectServer?.(id);
  }
}

export function renderTerminalTab() {
  const id = STATE.selectedId;
  if (!id) return;
  updateTerminalState(id);
  _deps.loadQuickCommands?.();
}

export async function buildTerminal(id) {
  teardownTerminal();
  const mount = document.getElementById('term-xterm');
  if (!mount) return;
  mount.innerHTML = '';

  const { WTerm } = await ensureWterm();

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/servers/${id}/shell`);
  ws.binaryType = 'arraybuffer';
  STATE.termWs = ws;

  const term = new WTerm(mount, {
    cursorBlink: true,
    autoResize: true,
    onData: (d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d); },
    onResize: (cols, rows) => {
      const m = document.getElementById('term-xterm');
      if (!m || m.offsetParent === null) return;
      if (cols < 2 || rows < 2) return;
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    },
  });
  await term.init();
  applyTerminalTheme();
  STATE.xtermInst = term;
  term.focus();

  ws.onmessage = (e) => term.write(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data);
  ws.onclose   = () => {
    term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
    if (STATE.termWs === ws) STATE.termWs = null;
  };
  ws.onerror = () => term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
}

// OTP-mode command console — a native, scrollable DOM console (not a live PTY).
// The single SSH channel is owned by the shared shell RPC, so each command runs
// via the /exec endpoint (which executes in that same persistent shell, so
// cd/env persist between commands). Built on the app's existing .rt-term-* CSS.
function buildCommandConsole(id) {
  teardownTerminal();
  const repl = document.getElementById('term-repl');
  if (!repl) return;
  const xtermHost = document.getElementById('term-xterm');
  if (xtermHost) xtermHost.style.display = 'none';   // hide the live-PTY host

  const out = document.createElement('div');
  out.className = 'rt-term-out';
  out.id = 'term-console-out';

  const inputRow = document.createElement('div');
  inputRow.className = 'rt-term-input';
  inputRow.id = 'term-console-input';
  const promptEl = document.createElement('span');
  promptEl.className = 'rt-term-prompt';
  const input = document.createElement('input');
  input.type = 'text';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Type a command and press Enter…';
  input.setAttribute('aria-label', 'Command input');
  inputRow.appendChild(promptEl);
  inputRow.appendChild(input);

  // Insert before the quick-commands drawer so it doesn't displace the layout.
  const drawer = document.getElementById('quick-drawer');
  repl.insertBefore(out, drawer || null);
  repl.insertBefore(inputRow, drawer || null);

  STATE.termConsole = true;
  STATE._termServerId = id;
  STATE._termConsoleEls = { out, inputRow, input };

  const server = STATE.servers.find(s => s.id === id) || {};
  const who = `${server.username || 'user'}@${server.label || server.host || 'host'}`;
  let cwd = '';

  // Last ≤3 path segments, e.g. "/home/sas/source_compile/foo" → "…/sas/source_compile/foo".
  function shortCwd(p) {
    const parts = (p || '').split('/').filter(Boolean);
    if (!parts.length) return '/';
    return (parts.length > 3 ? '…/' : '/') + parts.slice(-3).join('/');
  }
  function promptStr() { return `${who}:${shortCwd(cwd)}$`; }
  function setPrompt() { promptEl.textContent = promptStr(); }
  setPrompt();

  const history = [];
  let histIdx = -1;   // -1 = not navigating
  let draft = '';

  const scrollToBottom = () => { out.scrollTop = out.scrollHeight; };

  function lineEl() { const d = document.createElement('div'); d.className = 'rt-term-line'; return d; }

  function appendInfo(text) {
    const d = lineEl();
    const pre = document.createElement('pre');
    pre.style.color = 'var(--rt-fg-muted)';
    pre.textContent = text;
    d.appendChild(pre);
    out.appendChild(d);
    scrollToBottom();
  }

  function appendCmd(cmd) {
    const d = lineEl();
    const p = document.createElement('span'); p.className = 'rt-term-prompt'; p.textContent = promptStr();
    const c = document.createElement('span'); c.className = 'cmd'; c.textContent = cmd;
    d.appendChild(p); d.appendChild(c);
    out.appendChild(d);
    scrollToBottom();
  }

  // Silently refresh the working directory (separate, un-rendered pwd run) so the
  // prompt tracks `cd`. Goes through the same serialized RPC queue server-side.
  function refreshCwd() {
    const es = new EventSource(`/api/servers/${id}/exec?cmd=${encodeURIComponent('pwd')}`);
    let buf = '';
    es.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === 'stdout') buf += d.data || '';
      else if (d.type === 'exit' || d.type === 'error') {
        es.close();
        const p = buf.trim().split('\n').pop();
        if (p && p.startsWith('/')) { cwd = p; setPrompt(); }
      }
    };
    es.onerror = () => es.close();
  }

  appendInfo('command console — one shell, no live TTY (use real ssh for vim/htop/less)');
  refreshCwd();

  function runCommand(cmd) {
    history.unshift(cmd);
    if (history.length > 200) history.pop();
    histIdx = -1; draft = '';
    appendCmd(cmd);

    const d = lineEl();
    const pre = document.createElement('pre');
    d.appendChild(pre);
    out.appendChild(d);

    input.disabled = true;
    const sse = new EventSource(`/api/servers/${id}/exec?cmd=${encodeURIComponent(cmd)}`);
    STATE.termConsoleSse = sse;

    const append = (text, cls) => {
      const span = document.createElement('span');
      if (cls === 'err') span.style.color = 'var(--rt-danger)';
      span.textContent = text;
      pre.appendChild(span);
      scrollToBottom();
    };
    const finish = () => {
      if (STATE.termConsoleSse === sse) STATE.termConsoleSse = null;
      input.disabled = false;
      input.focus();
      scrollToBottom();
      refreshCwd();   // the command may have cd'd — update the prompt
    };

    sse.onmessage = (e) => {
      let data; try { data = JSON.parse(e.data); } catch { data = { type: 'stdout', data: e.data }; }
      if (data.type === 'stdout') append(data.data || '');
      else if (data.type === 'stderr') append(data.data || '', 'err');
      else if (data.type === 'error') append('\n' + (data.data || 'error') + '\n', 'err');
      else if (data.type === 'exit') {
        sse.close();
        const badge = document.createElement('span');
        badge.className = 'rt-term-exit ' + (data.code === 0 ? 'ok' : 'fail');
        badge.textContent = 'exit ' + (data.code ?? 0);
        const bd = lineEl(); bd.appendChild(badge); out.appendChild(bd);
        finish();
      }
    };
    sse.onerror = () => {
      sse.close();
      append('\n[command channel closed]', 'err');
      finish();
    };
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (input.disabled) return;
      const cmd = input.value.trim();
      input.value = '';
      if (cmd) runCommand(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      if (histIdx === -1) draft = input.value;
      histIdx = Math.min(histIdx + 1, history.length - 1);
      input.value = history[histIdx];
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === -1) return;
      histIdx -= 1;
      input.value = histIdx === -1 ? draft : history[histIdx];
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      // Cancel a running command.
      if (STATE.termConsoleSse) {
        try { STATE.termConsoleSse.close(); } catch {}
        STATE.termConsoleSse = null;
        appendInfo('^C');
        input.disabled = false; input.focus();
      }
    }
  });

  // Quick commands PASTE into the input (user reviews, then presses Enter).
  STATE._consoleExternal = (cmd) => { input.value = cmd; input.focus(); };

  input.focus();
}

export function runTerminalCommand(cmd) {
  // Command-panel mode: run through the DOM command console.
  if (effectiveTerminalMode(STATE.selectedId) !== 'pty') { STATE._consoleExternal?.(cmd); return; }
  // Live PTY: stream over the WebSocket.
  if (STATE.termWs && STATE.termWs.readyState === WebSocket.OPEN) {
    STATE.termWs.send(cmd + '\n');
  }
}
