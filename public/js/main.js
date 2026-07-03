/* ===== Reconnect — main entry point ===== */

import { STATE } from './state.js';
import { icon } from './icons.js';
import { api } from './api.js';

// Core
import { initTheme, toggleTheme, applyEditorTheme } from './theme.js';

// UI
import { toast } from './ui/toast.js';
import { renderServerList, loadServers, setSidebarCollapsed, openMobileNav, closeMobileNav, _setSidebarDeps } from './ui/sidebar.js';
import { updateStatusPill } from './ui/statusPill.js';
import { setTab, _setTabDeps } from './ui/tabs.js';
import { renderOverview, loadSysInfo, _setOverviewDeps } from './ui/overview.js';
import { renderServerNotes } from './ui/notes.js';
import { openGlobalNotes, closeGlobalNotes } from './ui/globalNotes.js';
import { setOutputPanel, appendOutput, loadOutputForServer, _setOutputPanelDeps } from './ui/outputPanel.js';
import { initResizeHandle, _setResizeDeps } from './ui/resize.js';

// Features
import { connectServer, disconnectServer, _setConnectDeps } from './features/connect.js';
import { teardownTerminal, parkTerminal, unparkTerminal, refitTerminal, refreshTerminal, updateTerminalState, renderTerminalTab, runTerminalCommand, _setTerminalDeps } from './features/terminal.js';
import { renderFilesTab, loadFileTree, renderEditorTabs, saveActiveFile, compileActiveFile, saveAndCompile, deleteActiveFile, createNewFile, initFileUpload, toggleBookmarksDrawer, loadSavedFiles, toggleBookmark, toggleFileTree, editorResponsiveResize, _setFilesConnect } from './features/files.js';
import { loadQuickCommands, toggleQuickDrawer, addQuickCommand, closeQcModal, saveQuickCommand, _setQuickCommandsDeps } from './features/quickCommands.js';

// Modals
import { openServerModalById, closeServerModal, setServerAuthMode, setServerMethod, setServerExplorer, setServerTerminal, saveServerById, deleteCurrentServer, smRefreshDirty, _setServerModalDeps } from './modals/serverModal.js';
import { openSettings, closeSettings, updateSettingsUI, saveSettings, _setSettingsModalDeps } from './modals/settingsModal.js';
import { openHelp, closeHelp } from './modals/helpModal.js';
import { openOtpModal, closeOtpModal, _setOtpDeps } from './modals/otpModal.js';

/* ===== Dependency injection (breaks circular imports) ===== */

// sidebar needs: selectServer, pollStatus
_setSidebarDeps(
  (id, restoring) => selectServer(id, restoring),
  (id) => pollStatus(id)
);

// tabs needs: toggleQuickDrawer, toggleBookmarksDrawer, parkTerminal, unparkTerminal, renderTerminalTab, renderFilesTab, renderOverview, loadSysInfo
_setTabDeps({
  toggleQuickDrawer,
  toggleBookmarksDrawer,
  parkTerminal,
  unparkTerminal,
  renderTerminalTab,
  renderFilesTab,
  renderOverview,
  loadSysInfo,
  renderServerNotes,
});

// outputPanel / resize need: refitTerminal
_setOutputPanelDeps(refitTerminal);
_setResizeDeps(refitTerminal);

// connect needs: updateStatusPill, renderServerList, renderOverview, loadSysInfo, teardownTerminal, openOtpModal
_setConnectDeps({
  updateStatusPill: (id) => updateStatusPill(id),
  renderServerList: () => renderServerList(),
  renderOverview,
  loadSysInfo,
  teardownTerminal,
  openOtpModal,
});

// terminal needs: connectServer, loadQuickCommands
_setTerminalDeps({
  connectServer,
  loadQuickCommands,
});

// files needs: connectServer (for the disconnected-state Connect button)
_setFilesConnect(connectServer);

// quickCommands needs: runTerminalCommand
_setQuickCommandsDeps(runTerminalCommand);

// otpModal needs: disconnectServer
_setOtpDeps((id) => disconnectServer(id));

// serverModal needs: loadServers, selectServer
_setServerModalDeps(
  () => _loadServersAndRestore(),
  (id, restoring) => selectServer(id, restoring)
);

// settingsModal needs: loadServers (to refresh effective flows after a scope change)
_setSettingsModalDeps(() => _loadServersAndRestore());

// overview needs: loadServers (to refresh after an inline flow toggle)
_setOverviewDeps(() => _loadServersAndRestore());

/* ===== selectServer (orchestrator, lives here) ===== */
function selectServer(id, restoring = false) {
  if (STATE.selectedId !== id) teardownTerminal();
  STATE.selectedId = id;
  localStorage.setItem('rt-selected-id', id);
  renderServerList(document.getElementById('server-search')?.value || '');

  const server = STATE.servers.find(s => s.id === id);
  if (!server) return;

  document.getElementById('welcome-view').style.display = 'none';
  const sv = document.getElementById('server-view');
  sv.style.display = 'flex';

  _updateStatusPillFull(id);

  if (!restoring) {
    setTab('overview');
  } else {
    setTab(STATE.centerTab);
  }
  renderOverview(server);
}

/* Full updateStatusPill — handles connect/disconnect button visibility + terminal state */
function _updateStatusPillFull(id) {
  const status = STATE.serverStatus[id] || 'disconnected';
  const pill   = document.getElementById('status-pill');
  const dot    = document.getElementById('status-dot');
  const txt    = document.getElementById('status-text');
  const connectBtn    = document.getElementById('connect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');

  if (pill) pill.className = `rt-status-pill ${status}`;
  if (dot) dot.className = `rt-status-dot ${status}`;
  const labels = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected' };
  if (txt) txt.textContent = labels[status] || 'Disconnected';

  const ovConnect    = document.getElementById('ov-connect-btn');
  const ovDisconnect = document.getElementById('ov-disconnect-btn');

  if (status === 'connected') {
    if (connectBtn) connectBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
    if (ovConnect) ovConnect.style.display = 'none';
    if (ovDisconnect) ovDisconnect.style.display = 'inline-flex';
  } else {
    if (connectBtn) {
      connectBtn.style.display = 'inline-flex';
      connectBtn.disabled = status === 'connecting';
      connectBtn.innerHTML = status === 'connecting'
        ? `${icon('spinner', 14)} Connecting…`
        : `${icon('connect', 14)} Connect`;
    }
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (ovConnect) {
      ovConnect.style.display = 'inline-flex';
      ovConnect.disabled = status === 'connecting';
      ovConnect.innerHTML = status === 'connecting'
        ? `${icon('spinner', 13)} <span class="rt-btn-txt">Connecting…</span>`
        : `${icon('connect', 13)} <span class="rt-btn-txt">Connect</span>`;
    }
    if (ovDisconnect) ovDisconnect.style.display = 'none';
  }

  updateTerminalState(id);
}

// Patch updateStatusPill in statusPill module via re-export shim is too complex;
// instead the _setConnectDeps already uses this closure:
// We replace the imported updateStatusPill from statusPill.js with our full version.
// Re-inject with full version:
_setConnectDeps({
  updateStatusPill: _updateStatusPillFull,
  renderServerList: () => renderServerList(),
  renderOverview,
  loadSysInfo,
  teardownTerminal,
  openOtpModal,
});

/* ===== STATUS POLLING ===== */
async function pollStatus(id) {
  if (!id) return;
  try {
    const data = await api(`/api/servers/${id}/status`);
    const newStatus = (data.status === 'ready' || data.status === 'connected')
      ? 'connected'
      : (data.status === 'connecting' || data.status === 'awaiting_otp')
        ? 'connecting'
        : 'disconnected';
    const prevStatus = STATE.serverStatus[id];
    if (prevStatus !== newStatus) {
      STATE.serverStatus[id] = newStatus;
      if (STATE.selectedId === id) {
        _updateStatusPillFull(id);
        const server = STATE.servers.find(s => s.id === id);
        if (server) renderOverview(server);
        renderServerList();
      }
      if (newStatus === 'connected' && prevStatus !== 'connected' && !STATE.sysInfo[id] && !STATE.sysInfoLoading[id]) {
        loadSysInfo(id);
      }
      // Populate the active tab as soon as a connection comes up (e.g. after the
      // file-explorer Connect button or the OTP flow completes).
      if (newStatus === 'connected' && prevStatus !== 'connected' && STATE.selectedId === id) {
        if (STATE.centerTab === 'files') loadFileTree();
        else if (STATE.centerTab === 'terminal') updateTerminalState(id);
      }
      if (newStatus === 'disconnected') {
        delete STATE.sysInfo[id];
        delete STATE.sysInfoLoading[id];
      }
    }
  } catch (e) { /* ignore */ }
}

/* ===== LOAD SERVERS (wrapper that restores selection) ===== */
async function _loadServersAndRestore() {
  try {
    const data = await api('/api/servers');
    STATE.servers = data;
    renderServerList(document.getElementById('server-search')?.value || '');
    await Promise.all(STATE.servers.map(s => pollStatus(s.id)));
    const savedId = parseInt(localStorage.getItem('rt-selected-id') || '0', 10);
    if (savedId && STATE.servers.find(s => s.id === savedId)) {
      selectServer(savedId, true);
    }
  } catch (e) {
    toast('Failed to load servers: ' + e.message, 'error');
  }
}

/* ===== INIT UI — wire all button events ===== */
function initUI() {
  // Icons
  document.getElementById('rail-logo').innerHTML = icon('logo', 24);
  document.getElementById('rail-sidebar-btn').innerHTML = icon('menu', 16);
  document.getElementById('rail-panel-btn').innerHTML = icon('terminal', 16);
  document.getElementById('rail-notes-btn').innerHTML = icon('notes', 16);
  document.getElementById('rail-settings-btn').innerHTML = icon('settings', 16);
  document.getElementById('rail-help-btn').innerHTML = icon('info', 16);
  document.getElementById('mb-logo').innerHTML = icon('logo', 20);
  document.getElementById('mb-nav-btn').innerHTML = icon('menu', 16);
  document.getElementById('mb-panel-btn').innerHTML = icon('terminal', 16);
  document.getElementById('mb-settings-btn').innerHTML = icon('settings', 16);
  document.getElementById('mb-help-btn').innerHTML = icon('info', 16);
  document.getElementById('welcome-ico').innerHTML = icon('server', 48);
  document.getElementById('welcome-add-btn').innerHTML = `${icon('plus', 14)} Add Server`;
  document.getElementById('editor-empty-ico').innerHTML = icon('file', 32);
  document.getElementById('out-bar-ico').innerHTML = icon('terminal', 14);
  document.getElementById('out-empty-ico').innerHTML = icon('terminal', 32);
  document.getElementById('connect-btn').innerHTML = `${icon('connect', 14)} Connect`;
  document.getElementById('disconnect-btn').innerHTML = `${icon('disconnect', 14)} Disconnect`;
  document.getElementById('out-clear-btn').innerHTML = icon('clear', 14);
  document.getElementById('out-close-btn').innerHTML = icon('close', 14);

  // Tabs icons
  document.getElementById('tab-overview').innerHTML = `${icon('server', 13)} Overview`;
  document.getElementById('tab-terminal').innerHTML = `${icon('terminal', 13)} Terminal`;
  document.getElementById('tab-files').innerHTML = `${icon('folder', 13)} Files`;
  document.getElementById('tab-notes').innerHTML = `${icon('notes', 13)} Notes`;

  // Search icon
  document.getElementById('search-ico').innerHTML = icon('search', 14);

  // Rail
  document.getElementById('rail-sidebar-btn').addEventListener('click', () => {
    if (window.innerWidth < 768) {
      if (STATE.mobileNavOpen) closeMobileNav(); else openMobileNav();
    } else {
      setSidebarCollapsed(!STATE.sidebarCollapsed);
    }
  });
  document.getElementById('rail-panel-btn').addEventListener('click', () => {
    setOutputPanel(!STATE.panelOpen);
    if (STATE.panelOpen && STATE.selectedId) loadOutputForServer(STATE.selectedId);
  });
  document.getElementById('mb-panel-btn').addEventListener('click', () => {
    setOutputPanel(!STATE.panelOpen);
    if (STATE.panelOpen && STATE.selectedId) loadOutputForServer(STATE.selectedId);
  });
  document.getElementById('rail-theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('mb-theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('rail-settings-btn').addEventListener('click', openSettings);
  document.getElementById('mb-settings-btn').addEventListener('click', openSettings);
  document.getElementById('rail-help-btn').addEventListener('click', openHelp);
  document.getElementById('mb-help-btn').addEventListener('click', openHelp);
  document.getElementById('rail-notes-btn').addEventListener('click', openGlobalNotes);
  document.getElementById('gn-title-ico').innerHTML = icon('notes', 17);
  document.getElementById('gn-close').innerHTML = icon('close', 14);
  document.getElementById('gn-close').addEventListener('click', closeGlobalNotes);

  // Mobile nav
  document.getElementById('mb-nav-btn').addEventListener('click', () => {
    if (STATE.mobileNavOpen) closeMobileNav(); else openMobileNav();
  });
  document.getElementById('backdrop').addEventListener('click', closeMobileNav);

  // Sidebar
  document.getElementById('add-server-btn').innerHTML = icon('plus', 14);
  document.getElementById('add-server-btn').addEventListener('click', () => openServerModalById(null));
  document.getElementById('welcome-add-btn').addEventListener('click', () => openServerModalById(null));

  // Server search
  const searchInput = document.getElementById('server-search');
  if (searchInput) searchInput.addEventListener('input', e => renderServerList(e.target.value));

  // Tab buttons
  document.getElementById('tab-overview').addEventListener('click', () => setTab('overview'));
  document.getElementById('tab-terminal').addEventListener('click', () => setTab('terminal'));
  document.getElementById('tab-files').addEventListener('click', () => setTab('files'));
  document.getElementById('tab-notes').addEventListener('click', () => setTab('notes'));

  // Connect / Disconnect
  document.getElementById('connect-btn').addEventListener('click', () => {
    if (STATE.selectedId) connectServer(STATE.selectedId);
  });
  document.getElementById('disconnect-btn').addEventListener('click', () => {
    if (STATE.selectedId) disconnectServer(STATE.selectedId);
  });

  // Output panel
  document.getElementById('out-clear-btn').addEventListener('click', () => {
    if (STATE.selectedId) {
      STATE.outputs[STATE.selectedId] = [];
      const body = document.getElementById('out-body');
      if (body) {
        Array.from(body.querySelectorAll('.rt-out-line')).forEach(el => el.remove());
        const empty = document.getElementById('out-empty');
        if (empty) empty.style.display = 'flex';
      }
    }
  });
  document.getElementById('out-close-btn').addEventListener('click', () => setOutputPanel(false));

  // Overview toolbar
  const detailsEditBtn = document.getElementById('details-edit-btn');
  if (detailsEditBtn) {
    detailsEditBtn.innerHTML = `${icon('settings', 13)} <span class="rt-btn-txt">Settings</span>`;
    detailsEditBtn.addEventListener('click', () => { if (STATE.selectedId) openServerModalById(STATE.selectedId); });
  }
  const sysRefreshBtn = document.getElementById('sysinfo-refresh-btn');
  if (sysRefreshBtn) {
    sysRefreshBtn.innerHTML = `${icon('refresh', 13)} <span class="rt-btn-txt">Refresh</span>`;
    sysRefreshBtn.addEventListener('click', () => {
      if (STATE.selectedId && STATE.serverStatus[STATE.selectedId] === 'connected') {
        loadSysInfo(STATE.selectedId);
      }
    });
  }
  const ovConnect = document.getElementById('ov-connect-btn');
  if (ovConnect) {
    ovConnect.innerHTML = `${icon('connect', 13)} <span class="rt-btn-txt">Connect</span>`;
    ovConnect.addEventListener('click', () => { if (STATE.selectedId) connectServer(STATE.selectedId); });
  }
  const ovDisconnect = document.getElementById('ov-disconnect-btn');
  if (ovDisconnect) {
    ovDisconnect.innerHTML = `${icon('disconnect', 13)} <span class="rt-btn-txt">Disconnect</span>`;
    ovDisconnect.addEventListener('click', () => { if (STATE.selectedId) disconnectServer(STATE.selectedId); });
  }

  // Terminal
  document.getElementById('term-dis-ico').innerHTML = icon('disconnect', 32);
  const termRefreshBtn = document.getElementById('term-refresh-btn');
  if (termRefreshBtn) {
    termRefreshBtn.innerHTML = icon('refresh', 14);
    termRefreshBtn.addEventListener('click', refreshTerminal);
  }

  // Files — path edit helpers
  function openPathEdit() {
    document.getElementById('tree-breadcrumbs').style.display = 'none';
    document.getElementById('path-edit-btn').style.display = 'none';
    const f = document.getElementById('tree-path-form'); if (f) f.style.display = 'flex';
    const i = document.getElementById('tree-path-input'); if (i) { i.focus(); i.select(); }
  }
  function closePathEdit() {
    const f = document.getElementById('tree-path-form'); if (f) f.style.display = 'none';
    document.getElementById('tree-breadcrumbs').style.display = '';
    document.getElementById('path-edit-btn').style.display = '';
  }
  const pathForm = document.getElementById('tree-path-form');
  if (pathForm) pathForm.addEventListener('submit', e => { e.preventDefault(); loadFileTree(); closePathEdit(); });
  const pathEditBtn = document.getElementById('path-edit-btn');
  if (pathEditBtn) {
    pathEditBtn.innerHTML = icon('pencil', 13);
    pathEditBtn.addEventListener('click', openPathEdit);
  }
  const pathCancelBtn = document.getElementById('path-cancel-btn');
  if (pathCancelBtn) {
    pathCancelBtn.innerHTML = icon('chevronLeft', 13);
    pathCancelBtn.addEventListener('click', closePathEdit);
  }
  const pathInput = document.getElementById('tree-path-input');
  if (pathInput) pathInput.addEventListener('keydown', e => { if (e.key === 'Escape') closePathEdit(); });

  document.getElementById('refresh-tree-btn').innerHTML = icon('refresh', 13);
  document.getElementById('refresh-tree-btn').addEventListener('click', () => loadFileTree());
  document.getElementById('new-file-btn').innerHTML = icon('newFile', 13);
  document.getElementById('new-file-btn').addEventListener('click', createNewFile);
  document.getElementById('upload-btn').innerHTML = icon('upload', 13);
  document.getElementById('editor-empty-ico').innerHTML = icon('file', 32);

  document.getElementById('save-btn').innerHTML = `${icon('save', 13)} <span class="rt-btn-txt">Save</span>`;
  document.getElementById('save-btn').addEventListener('click', () => saveActiveFile());

  // Java split button: primary = Save + Compile; caret opens Save / Compile.
  const saveCompileBtn = document.getElementById('save-compile-btn');
  saveCompileBtn.innerHTML = `${icon('compile', 13)} <span class="rt-btn-txt">Save + Compile</span>`;
  saveCompileBtn.addEventListener('click', saveAndCompile);
  const saveMenu       = document.getElementById('save-menu');
  const saveMenuToggle = document.getElementById('save-menu-toggle');
  saveMenuToggle.innerHTML = icon('chevronDown', 13);
  const closeSaveMenu = () => { saveMenu.classList.remove('open'); saveMenuToggle.setAttribute('aria-expanded', 'false'); };
  saveMenuToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = saveMenu.classList.toggle('open');
    saveMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.getElementById('menu-save').innerHTML = `${icon('save', 13)} Save`;
  document.getElementById('menu-save').addEventListener('click', () => { closeSaveMenu(); saveActiveFile(); });
  document.getElementById('menu-compile').innerHTML = `${icon('compile', 13)} Compile`;
  document.getElementById('menu-compile').addEventListener('click', () => { closeSaveMenu(); compileActiveFile(); });
  document.addEventListener('click', closeSaveMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSaveMenu(); });

  document.getElementById('bookmark-file-btn').addEventListener('click', toggleBookmark);

  document.getElementById('toggle-bookmarks-btn').innerHTML = icon('bookmark', 13);
  document.getElementById('toggle-bookmarks-btn').addEventListener('click', () => toggleBookmarksDrawer());
  document.getElementById('saved-close-btn').innerHTML = icon('close', 14);
  document.getElementById('saved-close-btn').addEventListener('click', () => toggleBookmarksDrawer(false));
  document.querySelector('#saved-drawer .rt-saved-ico').innerHTML = icon('bookmark', 14);
  document.getElementById('delete-file-btn').innerHTML = `${icon('trash', 13)} <span class="rt-btn-txt">Delete</span>`;
  document.getElementById('delete-file-btn').addEventListener('click', deleteActiveFile);
  initFileUpload();

  // Server modal
  document.getElementById('sm-close').innerHTML = icon('close', 14);
  document.getElementById('sm-close').addEventListener('click', closeServerModal);
  document.getElementById('sm-cancel').addEventListener('click', closeServerModal);
  document.getElementById('sm-save').addEventListener('click', saveServerById);
  document.getElementById('sm-delete').addEventListener('click', deleteCurrentServer);
  // Enable "Save Changes" only once a field actually changes.
  ['sm-label', 'sm-host', 'sm-port', 'sm-user', 'sm-key', 'sm-pass'].forEach(id =>
    document.getElementById(id).addEventListener('input', smRefreshDirty));
  document.getElementById('sm-auth-key').addEventListener('click', () => setServerAuthMode('key'));
  document.getElementById('sm-auth-pass').addEventListener('click', () => setServerAuthMode('password'));
  document.getElementById('sm-auth-otp').addEventListener('click', () => setServerAuthMode('otp'));
  document.getElementById('sm-method-internal').addEventListener('click', () => setServerMethod('internal'));
  document.getElementById('sm-method-external').addEventListener('click', () => setServerMethod('external'));
  document.getElementById('sm-explorer-sftp').addEventListener('click', () => setServerExplorer('sftp'));
  document.getElementById('sm-explorer-onechannel').addEventListener('click', () => setServerExplorer('onechannel'));
  document.getElementById('sm-term-pty').addEventListener('click', () => setServerTerminal('pty'));
  document.getElementById('sm-term-console').addEventListener('click', () => setServerTerminal('console'));

  // Per-server connection profile (transport / auth / explorer / terminal) is
  // configured in the Settings dialog (details-edit-btn) — see serverModal.js.

  // Settings modal
  document.getElementById('sett-close').innerHTML = icon('close', 14);
  document.getElementById('sett-close').addEventListener('click', closeSettings);
  document.getElementById('help-close').addEventListener('click', closeHelp);
  document.getElementById('sett-done').addEventListener('click', saveSettings);
  document.getElementById('sett-auth-key').addEventListener('click', () => { STATE.authMode = 'key'; updateSettingsUI(); });
  document.getElementById('sett-password').addEventListener('click', () => { STATE.authMode = 'password'; updateSettingsUI(); });
  document.getElementById('sett-otp').addEventListener('click', () => { STATE.authMode = 'otp'; updateSettingsUI(); });
  document.getElementById('sett-method-internal').addEventListener('click', () => { STATE.defaultMethod = 'internal'; updateSettingsUI(); });
  document.getElementById('sett-method-external').addEventListener('click', () => { STATE.defaultMethod = 'external'; updateSettingsUI(); });
  document.getElementById('sett-explorer-sftp').addEventListener('click', () => { STATE.defaultExplorer = 'sftp'; updateSettingsUI(); });
  document.getElementById('sett-explorer-onechannel').addEventListener('click', () => { STATE.defaultExplorer = 'onechannel'; updateSettingsUI(); });
  document.getElementById('sett-term-pty').addEventListener('click', () => { STATE.defaultTerminal = 'pty'; updateSettingsUI(); });
  document.getElementById('sett-term-console').addEventListener('click', () => { STATE.defaultTerminal = 'console'; updateSettingsUI(); });
  document.getElementById('sett-scope-global').addEventListener('click', () => { STATE.authScope = 'global'; updateSettingsUI(); });
  document.getElementById('sett-scope-standalone').addEventListener('click', () => { STATE.authScope = 'standalone'; updateSettingsUI(); });

  // OTP modal
  document.getElementById('otp-cancel').addEventListener('click', closeOtpModal);

  // Quick commands
  document.getElementById('toggle-quick-btn').innerHTML = icon('lightning', 14);
  document.getElementById('toggle-quick-btn').addEventListener('click', () => toggleQuickDrawer());
  document.getElementById('quick-close-btn').innerHTML = icon('close', 14);
  document.getElementById('quick-close-btn').addEventListener('click', () => toggleQuickDrawer(false));
  document.getElementById('qc-add-btn').innerHTML = icon('plus', 14);
  document.getElementById('qc-add-btn').addEventListener('click', addQuickCommand);
  document.querySelector('#quick-drawer .rt-quick-ico').innerHTML = icon('lightning', 14);

  document.getElementById('qc-modal-close').innerHTML = icon('close', 14);
  document.getElementById('qc-modal-close').addEventListener('click', closeQcModal);
  document.getElementById('qc-cancel').addEventListener('click', closeQcModal);
  document.getElementById('qc-save').addEventListener('click', saveQuickCommand);
  document.getElementById('qc-command').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveQuickCommand(); } });

  // Close modals on overlay click
  ['server-modal', 'settings-modal', 'confirm-modal', 'qc-modal', 'help-modal'].forEach(modalId => {
    const overlay = document.getElementById(modalId);
    if (overlay) overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        const box = overlay.querySelector('.rt-modal');
        if (box) box.classList.remove('active');
        overlay.style.display = 'none';
      }
    });
  });
  // Global notes closes via its own handler so pending edits are flushed first.
  document.getElementById('global-notes-modal').addEventListener('click', e => {
    if (e.target.id === 'global-notes-modal') closeGlobalNotes();
  });

  // Escape key closes modals. Global notes is intentionally excluded: it holds a
  // live BlockNote editor that uses Escape for its own menus, so Escape must not
  // tear down the overlay (close it via the X button or click-outside instead).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['server-modal', 'settings-modal', 'confirm-modal', 'otp-modal', 'qc-modal', 'help-modal'].forEach(modalId => {
        const overlay = document.getElementById(modalId);
        if (overlay && overlay.style.display !== 'none') {
          const box = overlay.querySelector('.rt-modal');
          if (box) box.classList.remove('active');
          overlay.style.display = 'none';
        }
      });
    }
  });

  // Resize handle
  initResizeHandle();

  // Restore sidebar state
  if (STATE.sidebarCollapsed) setSidebarCollapsed(true);

  // Responsive Monaco options on resize
  let _edRz;
  window.addEventListener('resize', () => {
    clearTimeout(_edRz);
    _edRz = setTimeout(editorResponsiveResize, 150);
  });
}

/* ===== INIT ===== */
async function init() {
  initTheme();
  initUI();
  // Load the auth mode up front so the terminal/feature gating is correct on
  // first render (not only after the Settings modal is opened).
  try {
    const settings = await api('/api/settings');
    STATE.authScope       = settings.config_scope || settings.auth_scope || 'global';
    STATE.authMode        = settings.default_auth_mode || settings.auth_mode || 'otp';
    STATE.defaultMethod   = settings.default_connection_method || 'internal';
    STATE.defaultExplorer = settings.default_explorer_mode || 'onechannel';
    STATE.defaultTerminal = settings.default_terminal_mode || 'console';
  } catch { /* defaults stay as initialized in STATE */ }
  await _loadServersAndRestore();

  // Periodic polling
  setInterval(() => {
    if (STATE.selectedId && STATE.serverStatus[STATE.selectedId] !== 'connecting') {
      pollStatus(STATE.selectedId);
    }
    STATE.servers.forEach(s => {
      if (STATE.serverStatus[s.id] === 'connected') pollStatus(s.id);
    });
  }, 5000);
}

document.addEventListener('DOMContentLoaded', init);
