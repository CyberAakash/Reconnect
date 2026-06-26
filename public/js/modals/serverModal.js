import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api, setBtnLoading } from '../api.js';
import { toast } from '../ui/toast.js';
import { confirm } from '../ui/confirm.js';

// Injected to avoid circular dep (serverModal -> loadServers -> sidebar -> selectServer -> serverModal)
let _loadServers, _selectServer;
export function _setServerModalDeps(loadServers, selectServer) {
  _loadServers = loadServers;
  _selectServer = selectServer;
}

let _editingServerId = null;

// Dirty-tracking: capture the form state when the dialog opens; "Save Changes"
// stays disabled until the user actually changes something (Add mode is always
// enabled — validation guards empty fields). `_smReady` suppresses the dirty
// check while openServerModalById populates the fields.
let _smReady = false;
let _smInitial = '';

function smSnapshot() {
  const authKey = document.getElementById('sm-auth-key').classList.contains('active');
  return [
    document.getElementById('sm-label').value.trim(),
    document.getElementById('sm-host').value.trim(),
    document.getElementById('sm-port').value.trim(),
    document.getElementById('sm-user').value.trim(),
    authKey ? 'key' : 'password',
    document.getElementById('sm-key').value.trim(),
    document.getElementById('sm-pass').value,
    document.getElementById('sm-method-internal').classList.contains('active') ? 'internal' : 'external',
    document.getElementById('sm-flow-otp').classList.contains('active') ? 'otp' : 'password',
    document.getElementById('sm-explorer-sftp').classList.contains('active') ? 'sftp' : 'onechannel',
    document.getElementById('sm-term-pty').classList.contains('active') ? 'pty' : 'console',
  ].join('');
}

// Enable Save only when the form differs from its opened state (edit mode).
export function smRefreshDirty() {
  if (!_smReady) return;
  const btn = document.getElementById('sm-save');
  if (!btn) return;
  btn.disabled = _editingServerId ? (smSnapshot() === _smInitial) : false;
}

export async function openServerModalById(id = null) {
  _editingServerId = id;
  _smReady = false;
  const overlay   = document.getElementById('server-modal');
  const box       = document.getElementById('server-modal-box');
  const titleText = document.getElementById('sm-title-text');
  const saveBtn   = document.getElementById('sm-save');

  const server = id ? STATE.servers.find(s => s.id === id) : null;

  document.getElementById('sm-title-ico').innerHTML = icon(server ? 'settings' : 'server', 16);
  titleText.textContent = server ? 'Server Settings' : 'Add Server';
  saveBtn.innerHTML = server ? `${icon('save', 13)} Save Changes` : `${icon('plus', 13)} Add Server`;
  // Clear any stuck disabled/spinner state left by a previous save.
  saveBtn.disabled = false;

  // Delete lives here too (only for existing servers).
  const delBtn = document.getElementById('sm-delete');
  if (delBtn) {
    delBtn.style.display = server ? '' : 'none';
    delBtn.innerHTML = `${icon('trash', 13)} Delete server`;
  }

  document.getElementById('sm-label').value = server?.label || '';
  document.getElementById('sm-host').value  = server?.host  || '';
  document.getElementById('sm-port').value  = server?.port  || 22;
  document.getElementById('sm-user').value  = server?.username || '';
  document.getElementById('sm-key').value   = server?.key_path || '';
  document.getElementById('sm-pass').value  = '';

  const isKey = !server || server.auth_type !== 'password';
  setServerAuthType(isKey ? 'key' : 'password');

  // Per-server auth flow: new servers default to OTP.
  setServerFlow(server?.auth_mode === 'password' ? 'password' : 'otp');
  // Per-server explorer / terminal: new servers default to the internal-safe modes.
  setServerExplorer(server?.explorer_mode === 'sftp' ? 'sftp' : 'onechannel');
  setServerTerminal(server?.terminal_mode === 'pty' ? 'pty' : 'console');
  // Per-server transport: new servers default to Internal (zero-trust proxy).
  // Set last so its hint-refresh sees the explorer/terminal selections.
  setServerMethod(server?.connection_method === 'external' ? 'external' : 'internal');

  ['sm-label-err', 'sm-host-err', 'sm-user-err', 'sm-port-err'].forEach(eid => {
    const el = document.getElementById(eid);
    if (el) el.style.display = 'none';
  });

  // Snapshot the populated state, then arm dirty-tracking.
  _smInitial = smSnapshot();
  _smReady = true;
  smRefreshDirty();

  overlay.style.display = 'flex';
  setTimeout(() => { box.classList.add('active'); document.getElementById('sm-label').focus(); }, 10);
}

export function closeServerModal() {
  const overlay = document.getElementById('server-modal');
  const box     = document.getElementById('server-modal-box');
  box.classList.remove('active');
  overlay.style.display = 'none';
}

export function setServerAuthType(type) {
  document.getElementById('sm-auth-key').classList.toggle('active', type === 'key');
  document.getElementById('sm-auth-pass').classList.toggle('active', type === 'password');
  document.getElementById('sm-auth-key').setAttribute('aria-pressed', type === 'key');
  document.getElementById('sm-auth-pass').setAttribute('aria-pressed', type === 'password');
  document.getElementById('sm-key-field').style.display  = type === 'key'      ? '' : 'none';
  document.getElementById('sm-pass-field').style.display = type === 'password' ? '' : 'none';
  smRefreshDirty();
}

export function setServerFlow(mode) {
  const otp = mode === 'otp';
  document.getElementById('sm-flow-otp').classList.toggle('active', otp);
  document.getElementById('sm-flow-password').classList.toggle('active', !otp);
  document.getElementById('sm-flow-otp').setAttribute('aria-pressed', otp);
  document.getElementById('sm-flow-password').setAttribute('aria-pressed', !otp);
  smRefreshDirty();
}

export function setServerExplorer(mode) {
  const sftp = mode === 'sftp';
  document.getElementById('sm-explorer-sftp').classList.toggle('active', sftp);
  document.getElementById('sm-explorer-onechannel').classList.toggle('active', !sftp);
  document.getElementById('sm-explorer-sftp').setAttribute('aria-pressed', sftp);
  document.getElementById('sm-explorer-onechannel').setAttribute('aria-pressed', !sftp);
  refreshMethodHints();
}

export function setServerTerminal(mode) {
  const pty = mode === 'pty';
  document.getElementById('sm-term-pty').classList.toggle('active', pty);
  document.getElementById('sm-term-console').classList.toggle('active', !pty);
  document.getElementById('sm-term-pty').setAttribute('aria-pressed', pty);
  document.getElementById('sm-term-console').setAttribute('aria-pressed', !pty);
  refreshMethodHints();
}

// Allow + warn: every axis stays selectable, but on Internal transport the
// gateway blocks the SFTP subsystem, so an SFTP pick on Internal is flagged as
// falling back to one-channel. Live PTY DOES work over the gateway, so it is
// not flagged.
function refreshMethodHints() {
  const internal = document.getElementById('sm-method-internal')?.classList.contains('active');
  const flowHint = document.getElementById('sm-flow-hint');
  const expHint  = document.getElementById('sm-explorer-hint');
  const termHint = document.getElementById('sm-term-hint');
  if (flowHint) flowHint.textContent = internal
    ? 'Internal only. Used when config scope is Per-server (see Settings).'
    : 'External servers authenticate with the stored key/password — flow does not apply.';
  const sftp = document.getElementById('sm-explorer-sftp')?.classList.contains('active');
  if (expHint) expHint.innerHTML = internal && sftp
    ? '⚠ The zero-trust gateway blocks SFTP — Internal hosts fall back to one-channel (base64). Use External for SFTP.'
    : 'SFTP is faster &amp; binary-safe; one-channel works anywhere a shell does.';
  if (termHint) termHint.textContent = 'Live PTY supports vim/htop/less; command panel runs one command at a time.';
  smRefreshDirty();
}

export function setServerMethod(method) {
  const internal = method !== 'external';
  document.getElementById('sm-method-internal').classList.toggle('active', internal);
  document.getElementById('sm-method-external').classList.toggle('active', !internal);
  document.getElementById('sm-method-internal').setAttribute('aria-pressed', internal);
  document.getElementById('sm-method-external').setAttribute('aria-pressed', !internal);
  refreshMethodHints();
}

export async function saveServerById() {
  const saveBtn  = document.getElementById('sm-save');
  const label    = document.getElementById('sm-label').value.trim();
  const host     = document.getElementById('sm-host').value.trim();
  const port     = parseInt(document.getElementById('sm-port').value, 10) || 22;
  const username = document.getElementById('sm-user').value.trim();
  const authKey  = document.getElementById('sm-auth-key').classList.contains('active');
  const key_path = document.getElementById('sm-key').value.trim();
  const password = document.getElementById('sm-pass').value;
  const connection_method = document.getElementById('sm-method-internal').classList.contains('active') ? 'internal' : 'external';
  const auth_mode = document.getElementById('sm-flow-otp').classList.contains('active') ? 'otp' : 'password';
  const explorer_mode = document.getElementById('sm-explorer-sftp').classList.contains('active') ? 'sftp' : 'onechannel';
  const terminal_mode = document.getElementById('sm-term-pty').classList.contains('active') ? 'pty' : 'console';

  let valid = true;
  [['sm-label-err', !label, 'Label is required'],
   ['sm-host-err',  !host,  'Host is required'],
   ['sm-user-err',  !username, 'Username is required']].forEach(([errId, cond, msg]) => {
    const el = document.getElementById(errId);
    if (el) { el.textContent = msg; el.style.display = cond ? 'block' : 'none'; }
    if (cond) valid = false;
  });
  if (!valid) return;

  const body = {
    label, host, port, username, auth_mode, connection_method, explorer_mode, terminal_mode,
    auth_type: authKey ? 'key' : 'password',
    key_path:  authKey ? key_path : '',
    password:  !authKey ? password : '',
  };

  setBtnLoading(saveBtn, true);
  try {
    if (_editingServerId) {
      await api(`/api/servers/${_editingServerId}`, { method: 'PUT', body: { ...body, id: _editingServerId } });
      toast('Server updated');
    } else {
      await api('/api/servers', { method: 'POST', body });
      toast('Server added');
    }
    closeServerModal();
    await _loadServers?.();
    if (_editingServerId && STATE.selectedId === _editingServerId) {
      _selectServer?.(_editingServerId, true);
    }
  } catch (e) {
    setBtnLoading(saveBtn, false);
    toast('Error: ' + e.message, 'error');
  }
}

// Delete the server currently open in the Settings dialog, then close it.
export async function deleteCurrentServer() {
  const id = _editingServerId;
  if (!id) return;
  await deleteServer(id);                                  // confirms + deletes + reloads
  if (!STATE.servers.find(s => s.id === id)) closeServerModal();  // close only if it was actually removed
}

export async function deleteServer(id) {
  const server = STATE.servers.find(s => s.id === id);
  if (!server) return;
  const ok = await confirm('Delete server?', `Delete "${server.label}"? This cannot be undone.`, 'Delete', true);
  if (!ok) return;
  try {
    await api(`/api/servers/${id}`, { method: 'DELETE' });
    toast('Server deleted');
    if (STATE.selectedId === id) {
      STATE.selectedId = null;
      document.getElementById('server-view').style.display = 'none';
      document.getElementById('welcome-view').style.display = '';
    }
    await _loadServers?.();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}
