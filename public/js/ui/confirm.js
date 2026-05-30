import { icon } from '../icons.js';

export function confirm(title, msg, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal');
    const box = document.getElementById('confirm-box');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    document.getElementById('confirm-ico').innerHTML = icon(danger ? 'trash' : 'info', 24);
    okBtn.textContent = okLabel;
    okBtn.className = `rt-btn ${danger ? 'danger' : 'primary'}`;
    overlay.style.display = 'flex';
    setTimeout(() => box.classList.add('active'), 10);

    function cleanup(val) {
      box.classList.remove('active');
      overlay.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(val);
    }
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}
