import { icon } from '../icons.js';

/* Reusable text-input modal — a custom replacement for window.prompt().
   Resolves to the trimmed string on OK/Enter, or null on Cancel/Escape/close. */
export function promptModal({ title = 'Enter a value', label = '', value = '', okLabel = 'OK', placeholder = '' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('prompt-modal');
    const box     = document.getElementById('prompt-box');
    const input   = document.getElementById('prompt-input');
    const okBtn   = document.getElementById('prompt-ok');
    const cancel  = document.getElementById('prompt-cancel');
    const close   = document.getElementById('prompt-close');
    const labelEl = document.getElementById('prompt-label');

    document.getElementById('prompt-title').textContent = title;
    close.innerHTML = icon('close', 16);
    labelEl.textContent = label;
    labelEl.style.display = label ? '' : 'none';
    okBtn.textContent = okLabel;
    input.value = value;
    input.placeholder = placeholder;

    overlay.style.display = 'flex';
    setTimeout(() => {
      box.classList.add('active');
      input.focus();
      input.select();
    }, 10);

    function cleanup(val) {
      box.classList.remove('active');
      overlay.style.display = 'none';
      okBtn.onclick = null;
      cancel.onclick = null;
      close.onclick = null;
      input.onkeydown = null;
      resolve(val);
    }
    const submit = () => { const v = input.value.trim(); cleanup(v || null); };
    okBtn.onclick = submit;
    cancel.onclick = () => cleanup(null);
    close.onclick = () => cleanup(null);
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };
  });
}
