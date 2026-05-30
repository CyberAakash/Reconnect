import { icon } from '../icons.js';

let _toastTimer;

export function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const ico = document.getElementById('toast-ico');
  const txt = document.getElementById('toast-text');
  if (!el) return;
  ico.innerHTML = icon(type === 'error' ? 'disconnect' : 'check', 14);
  txt.textContent = msg;
  el.className = `rt-toast ${type}`;
  el.style.display = 'flex';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}
