import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';

export async function openSettings() {
  const overlay = document.getElementById('settings-modal');
  const box     = document.getElementById('settings-modal-box');
  document.getElementById('sett-ico').innerHTML = icon('settings', 16);
  try {
    const settings = await api('/api/settings');
    STATE.authMode = settings.auth_mode || 'legacy';
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
  const otp = STATE.authMode === 'otp';
  document.getElementById('sett-otp').classList.toggle('active', otp);
  document.getElementById('sett-otp').setAttribute('aria-pressed', otp);
  document.getElementById('sett-legacy').classList.toggle('active', !otp);
  document.getElementById('sett-legacy').setAttribute('aria-pressed', !otp);

  const explainTxt = document.getElementById('sett-explain-txt');
  const explainIco = document.getElementById('sett-explain-ico');
  if (explainTxt && explainIco) {
    explainIco.innerHTML = icon(otp ? 'cpu' : 'connect', 14);
    explainTxt.textContent = otp
      ? 'Connecting will prompt you for a one-time passcode (OTP) as a second factor after key/password auth.'
      : 'Connecting authenticates with the stored key or password only — no second factor.';
  }
}

export async function saveSettings() {
  try {
    await api('/api/settings', { method: 'PUT', body: { auth_mode: STATE.authMode } });
    closeSettings();
    toast('Settings saved');
  } catch (e) {
    toast('Settings save failed: ' + e.message, 'error');
  }
}
