import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { esc, api } from '../api.js';

// Injected to avoid circular dep (overview -> loadServers -> sidebar -> ...)
let _loadServers;
export function _setOverviewDeps(loadServers) {
  _loadServers = loadServers;
}

// Read-only summary of the server's connection profile, shown next to its name
// in the overview toolbar. The four axes themselves are configured in the
// Settings dialog (the toolbar's Settings button → serverModal). A downgraded
// axis (SFTP/PTY requested on an internal host) is flagged amber with a tooltip.
export function updateInlineControls(server) {
  const wrap = document.getElementById('ov-axes-summary');
  if (!wrap) return;

  const internal = (server.effective_connection_method || server.connection_method) !== 'external';
  const chips = [];
  chips.push({ text: internal ? 'Internal' : 'External' });
  // Auth flow only matters for internal hosts.
  if (internal) chips.push({ text: (server.effective_auth_mode || server.auth_mode) === 'password' ? 'Password' : 'OTP' });
  chips.push({
    text: server.explorer_mode === 'sftp' ? 'SFTP' : 'One-channel',
    down: !!server.explorer_downgraded,
    title: server.explorer_downgraded ? 'SFTP unavailable on internal transport — using one-channel' : '',
  });
  chips.push({
    text: server.terminal_mode === 'pty' ? 'Live PTY' : 'Command panel',
    down: !!server.terminal_downgraded,
    title: server.terminal_downgraded ? 'Live PTY unavailable on internal transport — using command panel' : '',
  });

  wrap.innerHTML = chips.map(c =>
    `<span class="rt-axis-chip${c.down ? ' rt-axis-chip--down' : ''}"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.text)}</span>`
  ).join('');
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
