import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';

// Injected to avoid circular dep (settingsModal -> loadServers -> sidebar -> ...)
let _loadServers;
export function _setSettingsModalDeps(loadServers) {
  _loadServers = loadServers;
}

export async function openSettings() {
  const overlay = document.getElementById('settings-modal');
  const box     = document.getElementById('settings-modal-box');
  document.getElementById('sett-ico').innerHTML = icon('settings', 16);
  try {
    const settings = await api('/api/settings');
    STATE.authMode  = settings.auth_mode  || 'otp';
    STATE.authScope = settings.auth_scope || 'global';
  } catch (e) { /* ignore */ }
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

export function updateSettingsUI() {
  const standalone = STATE.authScope === 'standalone';

  // Scope toggle
  document.getElementById('sett-scope-global').classList.toggle('active', !standalone);
  document.getElementById('sett-scope-global').setAttribute('aria-pressed', !standalone);
  document.getElementById('sett-scope-standalone').classList.toggle('active', standalone);
  document.getElementById('sett-scope-standalone').setAttribute('aria-pressed', standalone);

  // Global flow toggle
  const otp = STATE.authMode === 'otp';
  document.getElementById('sett-otp').classList.toggle('active', otp);
  document.getElementById('sett-otp').setAttribute('aria-pressed', otp);
  document.getElementById('sett-password').classList.toggle('active', !otp);
  document.getElementById('sett-password').setAttribute('aria-pressed', !otp);

  // In standalone scope the global flow doesn't apply — dim it and explain.
  const globalField = document.getElementById('sett-global-flow');
  if (globalField) {
    globalField.style.opacity = standalone ? '0.5' : '';
    globalField.style.pointerEvents = standalone ? 'none' : '';
    globalField.setAttribute('aria-disabled', standalone);
  }

  const explainTxt = document.getElementById('sett-explain-txt');
  const explainIco = document.getElementById('sett-explain-ico');
  if (explainTxt && explainIco) {
    if (standalone) {
      explainIco.innerHTML = icon('server', 14);
      explainTxt.textContent = 'Each server uses its own connection flow — set it when creating or editing a server.';
    } else {
      explainIco.innerHTML = icon(otp ? 'cpu' : 'connect', 14);
      explainTxt.textContent = otp
        ? 'Connecting will prompt you for a one-time passcode (OTP) as a second factor after key/password auth.'
        : 'Connecting authenticates with the stored key or password only — no second factor.';
    }
  }
}

export async function saveSettings() {
  try {
    await api('/api/settings', { method: 'PUT', body: { auth_mode: STATE.authMode, auth_scope: STATE.authScope } });
    closeSettings();
    // Refresh the list so each server's effective flow (and inline toggles) update.
    await _loadServers?.();
    toast('Settings saved');
  } catch (e) {
    toast('Settings save failed: ' + e.message, 'error');
  }
}
