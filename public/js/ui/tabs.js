import { STATE } from '../state.js';

// These are injected at init time to break circular deps
let _deps = {};
export function _setTabDeps(deps) { Object.assign(_deps, deps); }

export function setTab(tab) {
  _deps.toggleQuickDrawer?.(false);
  _deps.toggleBookmarksDrawer?.(false);
  const prev = STATE.centerTab;
  STATE.centerTab = tab;
  ['overview', 'terminal', 'files'].forEach(t => {
    const btn = document.getElementById('tab-' + t);
    const view = document.getElementById('view-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
    if (btn) btn.setAttribute('aria-selected', t === tab);
    if (view) view.style.display = t === tab ? '' : 'none';
  });
  document.getElementById('tab-' + tab)?.scrollIntoView({ inline: 'center', block: 'nearest' });

  if (prev === 'terminal' && tab !== 'terminal') _deps.parkTerminal?.();
  if (tab === 'terminal') { _deps.renderTerminalTab?.(); requestAnimationFrame(() => _deps.unparkTerminal?.()); }
  if (tab === 'files') _deps.renderFilesTab?.();
  if (tab === 'overview') {
    const server = STATE.servers.find(s => s.id === STATE.selectedId);
    if (server) {
      _deps.renderOverview?.(server);
      if (STATE.serverStatus[server.id] === 'connected'
          && !STATE.sysInfo[server.id] && !STATE.sysInfoLoading[server.id]) {
        _deps.loadSysInfo?.(server.id);
      }
    }
  }
}
