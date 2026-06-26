import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';

// Injected to avoid circular dep (settingsModal -> loadServers -> sidebar -> ...)
let _loadServers;
export function _setSettingsModalDeps(loadServers) {
  _loadServers = loadServers;
}

// Dirty-tracking: "Done" (save + close) is enabled only when a default actually
// changed. Use the (X) close button to dismiss without saving.
let _settInitial = '';
function settSnapshot() {
  return [STATE.authScope, STATE.defaultMethod, STATE.authMode, STATE.defaultExplorer, STATE.defaultTerminal].join('|');
}

export async function openSettings() {
  const overlay = document.getElementById('settings-modal');
  const box     = document.getElementById('settings-modal-box');
  document.getElementById('sett-ico').innerHTML = icon('settings', 16);
  try {
    const settings = await api('/api/settings');
    STATE.authScope       = settings.config_scope || settings.auth_scope || 'global';
    STATE.authMode        = settings.default_auth_mode || settings.auth_mode || 'otp';
    STATE.defaultMethod   = settings.default_connection_method || 'internal';
    STATE.defaultExplorer = settings.default_explorer_mode || 'onechannel';
    STATE.defaultTerminal = settings.default_terminal_mode || 'console';
  } catch (e) { /* ignore */ }
  _settInitial = settSnapshot();
  updateSettingsUI();
  overlay.style.display = 'flex';
  setTimeout(() => box.classList.add('active'), 10);
}

export function closeSettings() {
  const overlay = document.getElementById('settings-modal');
  const box     = document.getElementById('settings-modal-box');
  box.classList.remove('active');
  overlay.style.display = 'none';
}

// Reflect a two-button segmented control's active/aria state.
function setSeg(activeId, otherId, isActive) {
  document.getElementById(activeId).classList.toggle('active', isActive);
  document.getElementById(activeId).setAttribute('aria-pressed', isActive);
  document.getElementById(otherId).classList.toggle('active', !isActive);
  document.getElementById(otherId).setAttribute('aria-pressed', !isActive);
}

export function updateSettingsUI() {
  const standalone = STATE.authScope === 'standalone';

  // Scope toggle
  setSeg('sett-scope-standalone', 'sett-scope-global', standalone);

  // Global default toggles
  setSeg('sett-method-internal', 'sett-method-external', STATE.defaultMethod !== 'external');
  setSeg('sett-otp', 'sett-password', STATE.authMode === 'otp');
  setSeg('sett-explorer-sftp', 'sett-explorer-onechannel', STATE.defaultExplorer === 'sftp');
  setSeg('sett-term-pty', 'sett-term-console', STATE.defaultTerminal === 'pty');

  // The defaults stay editable in every scope (you can set them anytime); the
  // scope just decides whether they apply. A faint dim signals "not in effect
  // right now" in per-server scope, but clicks still work.
  const defaults = document.getElementById('sett-defaults');
  if (defaults) {
    defaults.style.opacity = standalone ? '0.6' : '';
    defaults.style.pointerEvents = '';
    defaults.removeAttribute('aria-disabled');
  }

  const explainTxt = document.getElementById('sett-explain-txt');
  const explainIco = document.getElementById('sett-explain-ico');
  if (explainTxt && explainIco) {
    if (standalone) {
      explainIco.innerHTML = icon('server', 14);
      explainTxt.textContent = 'Per-server scope: each server uses its own settings. These defaults are saved but only take effect in Global scope.';
    } else {
      explainIco.innerHTML = icon('settings', 14);
      explainTxt.textContent = 'Global scope: these defaults apply to every server. Internal hosts still use one-channel files (the gateway blocks SFTP).';
    }
  }

  // Done saves + closes; enable it only when something changed.
  const done = document.getElementById('sett-done');
  if (done) done.disabled = settSnapshot() === _settInitial;
}

export async function saveSettings() {
  try {
    await api('/api/settings', { method: 'PUT', body: {
      config_scope: STATE.authScope,
      default_connection_method: STATE.defaultMethod,
      default_auth_mode: STATE.authMode,
      default_explorer_mode: STATE.defaultExplorer,
      default_terminal_mode: STATE.defaultTerminal,
    } });
    closeSettings();
    // Refresh the list so each server's effective flow (and inline toggles) update.
    await _loadServers?.();
    toast('Settings saved');
  } catch (e) {
    toast('Settings save failed: ' + e.message, 'error');
  }
}
