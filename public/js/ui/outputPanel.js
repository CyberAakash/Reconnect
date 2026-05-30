import { STATE } from '../state.js';
import { esc } from '../api.js';

// Injected to break circular dep with terminal
let _refitTerminal = () => {};
export function _setOutputPanelDeps(refitTerminal) { _refitTerminal = refitTerminal; }

export function setOutputPanel(open) {
  STATE.panelOpen = open;
  const panel  = document.getElementById('output-panel');
  const handle = document.getElementById('resize-handle');
  const railBtn = document.getElementById('rail-panel-btn');
  const mbBtn   = document.getElementById('mb-panel-btn');

  if (open) {
    panel.style.display = 'flex';
    const isMobile = window.innerWidth <= 1024;
    if (isMobile) {
      const savedMobile = parseInt(localStorage.getItem('rt-panel-h-mobile') || '0', 10);
      const defaultH = Math.round(window.innerHeight * 0.30);
      const maxH     = Math.round(window.innerHeight * 0.65);
      panel.style.height = Math.min(savedMobile || defaultH, maxH) + 'px';
    } else {
      panel.style.height = STATE.panelHeight + 'px';
    }
    handle.style.display = 'flex';
  } else {
    panel.style.display = 'none';
    handle.style.display = 'none';
  }

  [railBtn, mbBtn].forEach(btn => {
    if (btn) btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (btn) btn.classList.toggle('active', open);
  });

  requestAnimationFrame(_refitTerminal);
}

export function appendOutput(serverId, entry) {
  if (!STATE.outputs[serverId]) STATE.outputs[serverId] = [];
  STATE.outputs[serverId].push(entry);
  if (STATE.selectedId === serverId) renderOutputEntry(entry);
}

export function renderOutputEntry(entry) {
  const body  = document.getElementById('out-body');
  const empty = document.getElementById('out-empty');
  if (!body) return;
  if (empty) empty.style.display = 'none';

  const line = document.createElement('div');
  line.className = `rt-out-line ${entry.type || ''}`;
  const ts = new Date(entry.ts || Date.now()).toLocaleTimeString();
  let content = '';

  if (entry.type === 'cmd') {
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge cmd">CMD</span><span class="rt-out-cmd">${esc(entry.text)}</span>`;
  } else if (entry.type === 'stdout') {
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge stdout">OUT</span><pre class="rt-out-pre">${esc(entry.text)}</pre>`;
  } else if (entry.type === 'stderr') {
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge stderr">ERR</span><pre class="rt-out-pre rt-out-err">${esc(entry.text)}</pre>`;
  } else if (entry.type === 'exit') {
    const ok = entry.code === 0;
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge exit ${ok ? 'ok' : 'fail'}">EXIT ${entry.code}</span>`;
  } else if (entry.type === 'info') {
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge info">INFO</span><span>${esc(entry.text)}</span>`;
  } else if (entry.type === 'error') {
    content = `<span class="rt-out-ts">${ts}</span><span class="rt-out-badge stderr">ERROR</span><span class="rt-out-err">${esc(entry.text)}</span>`;
  } else {
    content = `<span class="rt-out-ts">${ts}</span><span>${esc(entry.text || '')}</span>`;
  }

  line.innerHTML = content;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

export function loadOutputForServer(id) {
  const body  = document.getElementById('out-body');
  const empty = document.getElementById('out-empty');
  if (!body) return;
  Array.from(body.querySelectorAll('.rt-out-line')).forEach(el => el.remove());
  const entries = STATE.outputs[id] || [];
  if (entries.length === 0) {
    if (empty) empty.style.display = 'flex';
  } else {
    if (empty) empty.style.display = 'none';
    entries.forEach(e => renderOutputEntry(e));
  }
  const src = document.getElementById('out-source');
  if (src) src.textContent = '';
}
