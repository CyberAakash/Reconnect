import { STATE, effectiveAuthMode, isInternal } from '../state.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { confirm } from '../ui/confirm.js';
import { appendOutput, setOutputPanel, loadOutputForServer } from '../ui/outputPanel.js';

// Injected at runtime to break circular deps
let _deps = {};
export function _setConnectDeps(deps) { Object.assign(_deps, deps); }

// OTP timeout auto-retry: count consecutive timeout-triggered reconnects per
// server so a slow/expired OTP automatically requests a fresh code (capped to
// avoid OTP-email spam / loops). Reset on a successful connect.
const _otpRetry = {};
const OTP_MAX_AUTO_RETRY = 3;

export function connectServer(id) {
  const server = STATE.servers.find(s => s.id === id);
  if (!server) return;

  STATE.serverStatus[id] = 'connecting';
  _deps.updateStatusPill?.(id);
  _deps.renderServerList?.();

  appendOutput(id, { type: 'info', text: `Connecting to ${server.label} (${server.username}@${server.host}:${server.port || 22})…`, ts: Date.now() });
  if (!STATE.panelOpen) setOutputPanel(true);
  loadOutputForServer(id);

  if (STATE.sseConnections[id]) { STATE.sseConnections[id].close(); delete STATE.sseConnections[id]; }

  _deps.teardownTerminal?.();
  STATE._termServerId = null;

  const sse = new EventSource(`/api/servers/${id}/connect`);
  STATE.sseConnections[id] = sse;

  sse.addEventListener('connected', e => {
    let data; try { data = JSON.parse(e.data); } catch { data = {}; }
    handleConnectEvent(id, { type: 'connected', ...data }, sse);
  });
  sse.addEventListener('prompt', e => {
    let data; try { data = JSON.parse(e.data); } catch { data = {}; }
    handleConnectEvent(id, { type: 'prompt', prompt: data.prompt || 'Enter one-time passcode:' }, sse);
  });
  sse.addEventListener('error', e => {
    if (!e.data) return;
    let data; try { data = JSON.parse(e.data); } catch { data = {}; }
    handleConnectEvent(id, { type: 'error', message: data.message || 'Connection failed' }, sse);
  });
  sse.onmessage = e => {
    let data;
    try { data = JSON.parse(e.data); } catch { data = { type: 'info', text: e.data }; }
    if (data.message) appendOutput(id, { type: 'info', text: data.message, ts: Date.now() });
  };
  sse.onerror = () => {
    if (STATE.serverStatus[id] === 'connecting') {
      STATE.serverStatus[id] = 'disconnected';
      appendOutput(id, { type: 'error', text: 'Connection stream closed unexpectedly', ts: Date.now() });
      if (STATE.selectedId === id) {
        _deps.updateStatusPill?.(id);
        loadOutputForServer(id);
        _deps.renderServerList?.();
      }
    }
    sse.close();
  };
}

function handleConnectEvent(id, data, sse) {
  switch (data.type) {
    case 'connected':
      STATE.serverStatus[id] = 'connected';
      _otpRetry[id] = 0;
      appendOutput(id, { type: 'info', text: `Connected successfully.`, ts: Date.now() });
      if (STATE.selectedId === id) {
        _deps.updateStatusPill?.(id);
        _deps.renderServerList?.();
        loadOutputForServer(id);
        _deps.renderOverview?.(STATE.servers.find(s => s.id === id));
      }
      _deps.loadSysInfo?.(id);
      break;
    case 'error': {
      sse.close();
      const msg = data.message || 'Error';
      // OTP timed out (slow email / slow entry): auto-start a fresh connection
      // so the user can use the latest code — like clicking Connect again.
      const isTimeout = /tim(e|ed)\s*out/i.test(msg);
      if (isInternal(id) && effectiveAuthMode(id) === 'otp' && isTimeout && (_otpRetry[id] || 0) < OTP_MAX_AUTO_RETRY) {
        _otpRetry[id] = (_otpRetry[id] || 0) + 1;
        appendOutput(id, { type: 'info', text: `OTP timed out — requesting a fresh passcode… (attempt ${_otpRetry[id]}/${OTP_MAX_AUTO_RETRY})`, ts: Date.now() });
        if (STATE.selectedId === id) loadOutputForServer(id);
        setTimeout(() => connectServer(id), 300);
        break;
      }
      _otpRetry[id] = 0;
      STATE.serverStatus[id] = 'disconnected';
      appendOutput(id, { type: 'error', text: msg, ts: Date.now() });
      if (STATE.selectedId === id) {
        _deps.updateStatusPill?.(id);
        _deps.renderServerList?.();
        loadOutputForServer(id);
      }
      toast(msg, 'error');
      break;
    }
    case 'prompt':
      _deps.openOtpModal?.(id, data.prompt || 'Enter one-time passcode:');
      break;
    case 'data':
    case 'stdout':
      appendOutput(id, { type: 'stdout', text: data.data || data.message || '', ts: Date.now() });
      if (STATE.selectedId === id) loadOutputForServer(id);
      break;
    default:
      if (data.message) {
        appendOutput(id, { type: 'info', text: data.message, ts: Date.now() });
        if (STATE.selectedId === id) loadOutputForServer(id);
      }
  }
}

export async function disconnectServer(id) {
  const ok = await confirm('Disconnect?', 'This will close the SSH session.', 'Disconnect', false);
  if (!ok) return;
  try {
    await api(`/api/servers/${id}/disconnect`, { method: 'POST' });
    STATE.serverStatus[id] = 'disconnected';
    delete STATE.sysInfo[id];
    delete STATE.sysInfoLoading[id];
    _deps.teardownTerminal?.();
    STATE._termServerId = null;
    if (STATE.sseConnections[id]) { STATE.sseConnections[id].close(); delete STATE.sseConnections[id]; }
    appendOutput(id, { type: 'info', text: 'Disconnected.', ts: Date.now() });
    if (STATE.selectedId === id) {
      _deps.updateStatusPill?.(id);
      _deps.renderServerList?.();
      loadOutputForServer(id);
      _deps.renderOverview?.(STATE.servers.find(s => s.id === id));
    }
    toast('Disconnected');
  } catch (e) {
    toast('Disconnect failed: ' + e.message, 'error');
  }
}
