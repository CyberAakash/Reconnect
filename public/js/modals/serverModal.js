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

export async function openServerModalById(id = null) {
  _editingServerId = id;
  const overlay   = document.getElementById('server-modal');
  const box       = document.getElementById('server-modal-box');
  const titleText = document.getElementById('sm-title-text');
  const saveBtn   = document.getElementById('sm-save');

  const server = id ? STATE.servers.find(s => s.id === id) : null;

  document.getElementById('sm-title-ico').innerHTML = icon('server', 16);
  titleText.textContent = server ? 'Edit Server' : 'Add Server';
  saveBtn.innerHTML = server ? `${icon('save', 13)} Save Changes` : `${icon('plus', 13)} Add Server`;

  document.getElementById('sm-label').value = server?.label || '';
  document.getElementById('sm-host').value  = server?.host  || '';
  document.getElementById('sm-port').value  = server?.port  || 22;
  document.getElementById('sm-user').value  = server?.username || '';
  document.getElementById('sm-key').value   = server?.key_path || '';
  document.getElementById('sm-pass').value  = '';

  const isKey = !server || server.auth_type !== 'password';
  setServerAuthType(isKey ? 'key' : 'password');

  ['sm-label-err', 'sm-host-err', 'sm-user-err', 'sm-port-err'].forEach(eid => {
    const el = document.getElementById(eid);
    if (el) el.style.display = 'none';
  });

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
    label, host, port, username,
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
