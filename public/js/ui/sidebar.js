import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { esc, api } from '../api.js';
import { toast } from './toast.js';

// selectServer and pollStatus are imported lazily at runtime to avoid circular dep
// (sidebar -> selectServer -> tabs -> sidebar)
let _selectServer, _pollStatus;
export function _setSidebarDeps(selectServer, pollStatus) {
  _selectServer = selectServer;
  _pollStatus   = pollStatus;
}

export function renderServerList(filter = '') {
  const list = document.getElementById('server-list');
  const count = document.getElementById('server-count');
  if (!list) return;

  const fl = filter.toLowerCase().trim();
  const filtered = STATE.servers.filter(s =>
    !fl || s.label.toLowerCase().includes(fl) ||
    s.host.toLowerCase().includes(fl) ||
    (s.username || '').toLowerCase().includes(fl)
  );

  count.textContent = STATE.servers.length;
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `<div class="rt-server-empty"><span>No servers found</span></div>`;
    return;
  }

  const connected = filtered.filter(s =>
    STATE.serverStatus[s.id] === 'ready' || STATE.serverStatus[s.id] === 'connected'
  );
  const disconnected = filtered.filter(s => !connected.includes(s));

  function buildItem(s) {
    const status = STATE.serverStatus[s.id] || 'disconnected';
    const isConnected = status === 'ready' || status === 'connected';
    const statusLabel = isConnected ? 'Connected' : 'Disconnected';
    const item = document.createElement('div');
    item.className = 'rt-server-item' + (STATE.selectedId === s.id ? ' active' : '');
    item.setAttribute('role', 'listitem');
    item.setAttribute('tabindex', '0');
    item.dataset.id = s.id;

    item.innerHTML = `
      <span class="rt-server-ico">${icon('server', 15)}</span>
      <div class="rt-server-meta">
        <span class="rt-server-name">${esc(s.label)}</span>
        <span class="rt-server-host">${esc(s.username || '')}${s.username ? '@' : ''}${esc(s.host)}:${s.port || 22}</span>
        <span class="rt-server-status-text ${isConnected ? 'connected' : 'disconnected'}">${statusLabel}</span>
      </div>
      <span class="rt-status-dot ${isConnected ? 'connected' : 'disconnected'}" title="${statusLabel}"></span>
    `;

    item.addEventListener('click', () => {
      _selectServer?.(s.id);
      if (window.innerWidth < 768) closeMobileNav();
    });
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _selectServer?.(s.id); }
    });
    return item;
  }

  if (connected.length > 0) {
    const label = document.createElement('div');
    label.className = 'rt-group-label';
    label.innerHTML = `${icon('connect', 10)} Connected <span style="opacity:.6">(${connected.length})</span>`;
    list.appendChild(label);
    connected.forEach(s => list.appendChild(buildItem(s)));
  }

  if (disconnected.length > 0) {
    const label = document.createElement('div');
    label.className = 'rt-group-label';
    label.innerHTML = `${icon('server', 10)} Servers <span style="opacity:.6">(${disconnected.length})</span>`;
    if (connected.length > 0) list.appendChild(label);
    disconnected.forEach(s => list.appendChild(buildItem(s)));
  }
}

export function setSidebarCollapsed(collapsed) {
  STATE.sidebarCollapsed = collapsed;
  localStorage.setItem('rt-sidebar-collapsed', collapsed ? '1' : '0');
  const sidebar = document.getElementById('sidebar');
  const app = document.getElementById('app');
  const expandBtn = document.getElementById('sidebar-expand-btn');
  const railBtn = document.getElementById('rail-sidebar-btn');
  if (collapsed) {
    sidebar.classList.add('collapsed');
    app.classList.add('sidebar-collapsed');
    if (expandBtn) { expandBtn.style.display = 'flex'; expandBtn.innerHTML = icon('chevronRight', 14); }
    if (railBtn) railBtn.classList.remove('active');
  } else {
    sidebar.classList.remove('collapsed');
    app.classList.remove('sidebar-collapsed');
    if (expandBtn) expandBtn.style.display = 'none';
    if (railBtn) railBtn.classList.add('active');
  }
}

export function openMobileNav() {
  STATE.mobileNavOpen = true;
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('backdrop').style.display = 'block';
  document.getElementById('mb-nav-btn').setAttribute('aria-expanded', 'true');
}

export function closeMobileNav() {
  STATE.mobileNavOpen = false;
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('backdrop').style.display = 'none';
  document.getElementById('mb-nav-btn').setAttribute('aria-expanded', 'false');
}

export async function loadServers() {
  try {
    const data = await api('/api/servers');
    STATE.servers = data;
    renderServerList(document.getElementById('server-search')?.value || '');
    await Promise.all(STATE.servers.map(s => _pollStatus?.(s.id)));
    const savedId = parseInt(localStorage.getItem('rt-selected-id') || '0', 10);
    if (savedId && STATE.servers.find(s => s.id === savedId)) {
      _selectServer?.(savedId, true);
    }
  } catch (e) {
    toast('Failed to load servers: ' + e.message, 'error');
  }
}
