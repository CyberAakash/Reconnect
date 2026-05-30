import { STATE } from '../state.js';

// Injected to break circular dep with terminal
let _refitTerminal = () => {};
export function _setResizeDeps(refitTerminal) { _refitTerminal = refitTerminal; }

export function initResizeHandle() {
  const handle = document.getElementById('resize-handle');
  if (!handle) return;
  let dragging = false, startY, startH;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startH = STATE.panelHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    const newH = Math.min(640, Math.max(140, startH + delta));
    STATE.panelHeight = newH;
    document.getElementById('output-panel').style.height = newH + 'px';
    if (STATE.centerTab === 'terminal') {
      const el = STATE.xtermInst?.element;
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('rt-panel-h', STATE.panelHeight);
    _refitTerminal();
  });

  handle.addEventListener('touchstart', e => {
    const t = e.touches[0];
    dragging = true;
    startY = t.clientY;
    startH = parseInt(document.getElementById('output-panel').style.height, 10) || STATE.panelHeight;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const delta = startY - t.clientY;
    const maxH = window.innerWidth <= 1024
      ? Math.round(window.innerHeight * 0.80)
      : 640;
    STATE.panelHeight = Math.min(maxH, Math.max(100, startH + delta));
    document.getElementById('output-panel').style.height = STATE.panelHeight + 'px';
    if (STATE.centerTab === 'terminal') {
      const el = STATE.xtermInst?.element;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    const key = window.innerWidth <= 1024 ? 'rt-panel-h-mobile' : 'rt-panel-h';
    localStorage.setItem(key, STATE.panelHeight);
    _refitTerminal();
  });
}
