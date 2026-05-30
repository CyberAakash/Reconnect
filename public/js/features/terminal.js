import { STATE } from '../state.js';
import { ensureWterm } from '../wterm.js';
import { applyTerminalTheme } from '../theme.js';

// Injected at runtime to break circular deps
let _deps = {};
export function _setTerminalDeps(deps) { Object.assign(_deps, deps); }

export function teardownTerminal() {
  if (STATE.termWs) { STATE.termWs.close(); STATE.termWs = null; }
  if (STATE.xtermInst) { STATE.xtermInst.destroy(); STATE.xtermInst = null; }
}

export function parkTerminal() {
  try { STATE.xtermInst?.resizeObserver?.disconnect(); } catch {}
}

export function unparkTerminal() {
  const t = STATE.xtermInst;
  if (!t || !t.resizeObserver || !t.element) return;
  try {
    t.resizeObserver.disconnect();
    t.resizeObserver.observe(t.element);
  } catch {}
  requestAnimationFrame(() => { try { t.focus(); } catch {} });
}

export function refitTerminal() {
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
    const _ws   = STATE.termWs;
    const _dead = !_ws || _ws.readyState === WebSocket.CLOSING || _ws.readyState === WebSocket.CLOSED;
    if (!STATE.xtermInst || STATE._termServerId !== id || _dead) {
      STATE._termServerId = id;
      buildTerminal(id);
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

export function runTerminalCommand(cmd) {
  if (STATE.termWs && STATE.termWs.readyState === WebSocket.OPEN) {
    STATE.termWs.send(cmd + '\n');
  }
}
