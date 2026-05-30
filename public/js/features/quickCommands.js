import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api, esc } from '../api.js';
import { toast } from '../ui/toast.js';
import { confirm } from '../ui/confirm.js';

// Injected to break circular dep (quickCommands -> runTerminalCommand -> terminal -> quickCommands)
let _runTerminalCommand;
export function _setQuickCommandsDeps(runTerminalCommand) { _runTerminalCommand = runTerminalCommand; }

export async function loadQuickCommands() {
  try {
    STATE.savedCommands = await api('/api/commands');
    renderQuickChips();
  } catch (e) { /* ignore */ }
}

export function toggleQuickDrawer(force) {
  const drawer = document.getElementById('quick-drawer');
  const btn    = document.getElementById('toggle-quick-btn');
  if (!drawer) return;
  const open = force !== undefined ? !!force : !STATE.quickOpen;
  STATE.quickOpen = open;
  if (open) {
    drawer.removeAttribute('hidden');
    requestAnimationFrame(() => drawer.classList.add('open'));
  } else {
    drawer.classList.remove('open');
    drawer.addEventListener('transitionend', () => {
      if (!STATE.quickOpen) drawer.setAttribute('hidden', '');
    }, { once: true });
  }
  if (btn) btn.classList.toggle('active', open);
}

function renderQuickChips() {
  const container = document.getElementById('quick-chips');
  if (!container) return;
  const countEl = document.getElementById('quick-count');
  if (countEl) countEl.textContent = STATE.savedCommands.length || '';
  container.innerHTML = '';

  if (!STATE.savedCommands.length) {
    container.innerHTML = '<span class="rt-saved-empty">No quick commands yet.<br>Click + to add one.</span>';
    return;
  }

  STATE.savedCommands.forEach(cmd => {
    const chip = document.createElement('button');
    chip.className = 'rt-quick-chip rt-corner-host';
    chip.title = cmd.command;
    chip.innerHTML = `
      <span class="rt-quick-chip-info">
        <span class="rt-quick-chip-label">${esc(cmd.label || cmd.command)}</span>
        <span class="rt-quick-chip-cmd">${esc(cmd.command)}</span>
      </span>
      <span class="rt-corner-actions">
        <button class="rt-corner-btn edit" data-id="${cmd.id}" aria-label="Edit">${icon('pencil', 11)}</button>
        <button class="rt-corner-btn del"  data-id="${cmd.id}" aria-label="Remove">${icon('close', 11)}</button>
      </span>`;
    chip.addEventListener('click', e => {
      if (e.target.closest('.rt-corner-btn.edit')) { editQuickCommand(cmd); return; }
      if (e.target.closest('.rt-corner-btn.del'))  { deleteQuickCommand(cmd.id, cmd.label || cmd.command); return; }
      _runTerminalCommand?.(cmd.command);
      toggleQuickDrawer(false);
    });
    container.appendChild(chip);
  });
}

function openQcModal(editCmd) {
  STATE._editingCommandId = editCmd ? editCmd.id : null;
  const overlay = document.getElementById('qc-modal');
  const box     = document.getElementById('qc-modal-box');
  document.getElementById('qc-modal-title').textContent = editCmd ? 'Edit Quick Command' : 'Add Quick Command';
  document.getElementById('qc-label').value   = editCmd ? (editCmd.label || '') : '';
  document.getElementById('qc-command').value = editCmd ? (editCmd.command || '') : '';
  overlay.style.display = 'flex';
  setTimeout(() => box.classList.add('active'), 10);
  document.getElementById('qc-label').focus();
}

export function addQuickCommand()       { openQcModal(null); }
export function editQuickCommand(cmd)   { openQcModal(cmd); }

export function closeQcModal() {
  const overlay = document.getElementById('qc-modal');
  const box     = document.getElementById('qc-modal-box');
  box.classList.remove('active');
  overlay.style.display = 'none';
  STATE._editingCommandId = null;
}

export async function saveQuickCommand() {
  const label   = document.getElementById('qc-label').value.trim();
  const command = document.getElementById('qc-command').value.trim();
  if (!label || !command) { toast('Label and command are required', 'error'); return; }
  try {
    const editId = STATE._editingCommandId;
    if (editId) {
      await api(`/api/commands/${editId}`, { method: 'PUT', body: { label, command } });
    } else {
      await api('/api/commands', { method: 'POST', body: { label, command } });
    }
    closeQcModal();
    await loadQuickCommands();
  } catch (e) {
    toast('Failed to save command: ' + e.message, 'error');
  }
}

async function deleteQuickCommand(id, label) {
  const ok = await confirm('Remove quick command?', `Remove "${label}" from quick commands?`, 'Remove', true);
  if (!ok) return;
  try {
    await api(`/api/commands/${id}`, { method: 'DELETE' });
    STATE.savedCommands = STATE.savedCommands.filter(c => c.id !== id);
    renderQuickChips();
  } catch (e) {
    toast('Failed to remove: ' + e.message, 'error');
  }
}
