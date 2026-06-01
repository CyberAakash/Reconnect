import { icon } from '../icons.js';

let loaded = false;

export function openHelp() {
  const overlay = document.getElementById('help-modal');
  const box     = document.getElementById('help-modal-box');
  document.getElementById('help-ico').innerHTML   = icon('info', 16);
  document.getElementById('help-close').innerHTML = icon('x', 16);
  document.getElementById('help-dl-ico').innerHTML = icon('download', 14);
  if (!loaded) {
    document.getElementById('help-frame').src = '/docs/index.html';
    loaded = true;
  }
  overlay.style.display = 'flex';
  setTimeout(() => box.classList.add('active'), 10);
}

export function closeHelp() {
  const overlay = document.getElementById('help-modal');
  const box     = document.getElementById('help-modal-box');
  box.classList.remove('active');
  overlay.style.display = 'none';
}
