import { icon } from '../icons.js';
import { api, setBtnLoading } from '../api.js';

// disconnectServer injected at runtime to avoid circular dep
let _disconnectServer;
export function _setOtpDeps(disconnectServer) { _disconnectServer = disconnectServer; }

export function openOtpModal(serverId, promptText) {
  const overlay = document.getElementById('otp-modal');
  const input   = document.getElementById('otp-input');
  const box     = document.getElementById('otp-modal-box');

  document.getElementById('otp-prompt-text').textContent = promptText;
  document.getElementById('otp-ico').innerHTML = icon('connect', 24);
  input.value = '';
  overlay.style.display = 'flex';
  setTimeout(() => { box.classList.add('active'); input.focus(); }, 10);

  const verify = document.getElementById('otp-verify');
  const cancel = document.getElementById('otp-cancel');

  async function doVerify() {
    const token = input.value.trim();
    if (!token) { input.focus(); return; }
    setBtnLoading(verify, true);
    try {
      await api(`/api/servers/${serverId}/otp`, { method: 'POST', body: { otp: token } });
      closeOtpModal();
    } catch (e) {
      setBtnLoading(verify, false);
      document.getElementById('otp-prompt-text').textContent = 'Invalid code. Try again.';
      input.value = '';
      input.focus();
    }
  }

  verify.onclick = doVerify;
  cancel.onclick = () => { closeOtpModal(); _disconnectServer?.(serverId).catch(() => {}); };
  input.onkeydown = e => { if (e.key === 'Enter') doVerify(); if (e.key === 'Escape') cancel.onclick(); };
}

export function closeOtpModal() {
  const overlay = document.getElementById('otp-modal');
  const box     = document.getElementById('otp-modal-box');
  box.classList.remove('active');
  overlay.style.display = 'none';
  setBtnLoading(document.getElementById('otp-verify'), false);
}
