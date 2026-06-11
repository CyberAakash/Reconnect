import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { esc, api } from '../api.js';
import { toast } from './toast.js';

// Injected to avoid circular dep (overview -> loadServers -> sidebar -> ...)
let _loadServers;
export function _setOverviewDeps(loadServers) {
  _loadServers = loadServers;
}

// Reflect the per-server transport + auth flow in the toolbar's inline toggles.
// Method (Internal/External) is always shown; the auth flow (OTP/Password) only
// applies to internal hosts and only when flow scope is 'standalone'.
export function updateInlineControls(server) {
  const methodSeg = document.getElementById('ov-method-seg');
  const flowSeg   = document.getElementById('ov-flow-seg');
  if (!methodSeg || !flowSeg) return;

  const internal = server.connection_method !== 'external';
  methodSeg.style.display = '';
  document.getElementById('ov-method-internal').classList.toggle('active', internal);
  document.getElementById('ov-method-internal').setAttribute('aria-pressed', internal);
  document.getElementById('ov-method-external').classList.toggle('active', !internal);
  document.getElementById('ov-method-external').setAttribute('aria-pressed', !internal);

  if (!internal || STATE.authScope !== 'standalone') { flowSeg.style.display = 'none'; return; }
  flowSeg.style.display = '';
  const otp = server.auth_mode !== 'password';
  document.getElementById('ov-flow-otp').classList.toggle('active', otp);
  document.getElementById('ov-flow-otp').setAttribute('aria-pressed', otp);
  document.getElementById('ov-flow-password').classList.toggle('active', !otp);
  document.getElementById('ov-flow-password').setAttribute('aria-pressed', !otp);
}

async function _patchSelected(path, body, okMsg) {
  const id = STATE.selectedId;
  if (!id) return;
  try {
    await api(`/api/servers/${id}/${path}`, { method: 'PUT', body });
    await _loadServers?.();
    const fresh = STATE.servers.find(s => s.id === id);
    if (fresh && STATE.centerTab === 'overview' && STATE.selectedId === id) renderOverview(fresh);
    toast(okMsg);
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

// Flip the selected server's auth flow (internal hosts only).
export async function toggleServerFlow(mode) {
  const server = STATE.servers.find(s => s.id === STATE.selectedId);
  if (server && (server.auth_mode || 'otp') === mode) return; // no-op
  await _patchSelected('auth-mode', { auth_mode: mode }, `Auth flow set to ${mode === 'otp' ? 'OTP' : 'Password'}`);
}

// Flip the selected server's transport.
export async function toggleServerMethod(method) {
  const server = STATE.servers.find(s => s.id === STATE.selectedId);
  if (server && (server.connection_method || 'internal') === method) return; // no-op
  await _patchSelected('connection-method', { connection_method: method }, `Connection set to ${method === 'internal' ? 'Internal' : 'External'}`);
}

function ringMeter(pct, size = 52) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(Math.max(pct || 0, 0), 100);
  const dash = (fill / 100) * circ;
  const color = fill > 80 ? 'var(--rt-danger,#ef4444)' : fill > 60 ? '#f59e0b' : 'var(--rt-accent)';
  const cx = size / 2, cy = size / 2;
  return `<svg class="rt-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" stroke="var(--rt-border)" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${color}" stroke-width="4"
      stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-family="var(--rt-mono)" font-size="${size > 44 ? '10' : '9'}" fill="var(--rt-fg)" font-weight="600">${fill}%</text>
  </svg>`;
}

export function renderOverview(server) {
  const bento = document.getElementById('bento-grid');
  if (!bento) return;

  const nameEl = document.getElementById('bento-server-name');
  if (nameEl) nameEl.textContent = server.label;

  updateInlineControls(server);

  const status = STATE.serverStatus[server.id] || 'disconnected';
  const isConnected = status === 'connected';
  const authDisplay = server.auth_type === 'key'
    ? `SSH Key (${server.key_path || 'default'})`
    : (server.auth_type === 'otp' ? 'Password + OTP' : 'Password');

  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const infoTile = (ico, lbl, val, mono = false, span = 1, sub = '') =>
    `<div class="rt-bt${span > 1 ? ` rt-bt--w${span}` : ''}">
      <span class="rt-bt-chip">${icon(ico, 15)}</span>
      <div class="rt-bt-body">
        <span class="rt-bt-lbl">${lbl}</span>
        <span class="rt-bt-val${mono ? ' mono' : ''}" title="${esc(String(val))}">${esc(String(val))}</span>
        ${sub ? `<span class="rt-bt-sub">${esc(sub)}</span>` : ''}
      </div>
    </div>`;

  const connectionTiles = `
    <div class="rt-bt rt-bt--w2">
      <span class="rt-bt-chip">${icon('info', 15)}</span>
      <div class="rt-bt-body">
        <span class="rt-bt-lbl">Host</span>
        <span class="rt-bt-val mono" title="${esc(server.host)}">${esc(server.host)}</span>
      </div>
    </div>
    ${infoTile('connect', 'Port', server.port || 22, true)}
    ${infoTile('terminal', 'Username', server.username || '—', true)}
    ${infoTile('settings', 'Authentication', authDisplay, false)}
    <div class="rt-bt rt-bt--status">
      <span class="rt-bt-chip rt-bt-chip--${status}">${icon('check', 15)}</span>
      <div class="rt-bt-body">
        <span class="rt-bt-lbl">Status</span>
        <span class="rt-bt-val">
          <span class="rt-status-dot ${status}" style="display:inline-block;margin-right:6px;vertical-align:middle"></span>${statusLabel}
        </span>
      </div>
    </div>
  `;

  if (!isConnected) {
    bento.innerHTML = connectionTiles + `
      <div class="rt-bt rt-bt--w4 rt-bt--empty">
        ${icon('cpu', 28)}
        <p>Connect to view live system info</p>
      </div>`;
    return;
  }

  const loading = STATE.sysInfoLoading[server.id];
  const info = STATE.sysInfo[server.id];

  if (loading) {
    const skTile = () => `<div class="rt-bt rt-bt--sk"><div class="rt-bt-chip rt-bt-chip--sk"></div><div class="rt-bt-body"><div class="sk-line sk-lbl"></div><div class="sk-line sk-val"></div></div></div>`;
    const skRing = () => `<div class="rt-bt rt-bt--ring rt-bt--sk"><div class="rt-ring-sk"></div><div class="rt-bt-body"><div class="sk-line sk-lbl"></div><div class="sk-line sk-val"></div></div></div>`;
    bento.innerHTML = connectionTiles + skRing() + skRing() + skTile() + skTile() + skTile() + skTile() + skTile() + skTile();
    return;
  }

  if (!info) {
    bento.innerHTML = connectionTiles + `
      <div class="rt-bt rt-bt--w4 rt-bt--empty">
        ${icon('info', 28)}
        <p>System info unavailable</p>
      </div>`;
    return;
  }

  let memPct = null, diskPct = null;
  if (info.MEM) {
    const parts = info.MEM.split('/');
    if (parts.length === 2) {
      const used = parseFloat(parts[0]), total = parseFloat(parts[1]);
      if (total > 0) memPct = Math.round((used / total) * 100);
    }
  }
  if (info.DISK) {
    const match = info.DISK.match(/\((\d+)%\)/);
    if (match) diskPct = parseInt(match[1]);
  }

  const memVal = info.MEM ? info.MEM.replace('/', ' / ') + ' MB' : '—';
  const diskVal = info.DISK ? info.DISK.replace(/\s*\(\d+%\)/, '') : '—';

  const ringTile = (ico, lbl, val, pct) => `
    <div class="rt-bt rt-bt--ring">
      <div class="rt-bt-ring-wrap">
        ${pct !== null ? ringMeter(pct, 60) : `<span class="rt-bt-chip">${icon(ico, 22)}</span>`}
      </div>
      <div class="rt-bt-body">
        <span class="rt-bt-lbl">${lbl}</span>
        <span class="rt-bt-val mono">${esc(val)}</span>
        ${pct !== null ? `<span class="rt-bt-sub">${pct}% used</span>` : ''}
      </div>
    </div>`;

  bento.innerHTML = connectionTiles
    + ringTile('memory', 'Memory', memVal, memPct)
    + ringTile('disk', 'Disk (/)', diskVal, diskPct)
    + infoTile('cpu', 'CPUs', info.CPUS || '—', true, 1, info.LOAD ? `Load: ${info.LOAD}` : '')
    + infoTile('clock', 'Uptime', info.UPTIME || '—')
    + infoTile('os', 'OS', info.OS || '—', false, 2)
    + infoTile('kernel', 'Kernel', info.KERNEL || '—', true)
    + infoTile('server', 'Hostname', info.HOST || '—', true)
    + infoTile('info', 'Arch', info.ARCH || '—', true);
}

export async function loadSysInfo(serverId) {
  STATE.sysInfoLoading[serverId] = true;
  const server = STATE.servers.find(s => s.id === serverId);
  if (server && STATE.centerTab === 'overview' && STATE.selectedId === serverId) renderOverview(server);
  try {
    const data = await api(`/api/servers/${serverId}/sysinfo`);
    STATE.sysInfo[serverId] = data;
  } catch (e) {
    STATE.sysInfo[serverId] = null;
  } finally {
    STATE.sysInfoLoading[serverId] = false;
    const s = STATE.servers.find(s => s.id === serverId);
    if (s && STATE.centerTab === 'overview' && STATE.selectedId === serverId) renderOverview(s);
  }
}
