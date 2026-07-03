/* Global Notes — a full-workspace overlay opened from the activity rail.
 * Reuses the shared note editor with the global scope (server_id = null) and
 * the app's standard overlay/modal show-hide pattern. */
import { mountNoteEditor } from '../features/noteEditor.js';

let _ctrl = null;

export function openGlobalNotes() {
  const overlay = document.getElementById('global-notes-modal');
  const box = document.getElementById('global-notes-box');
  if (!overlay || !box) return;
  const root = document.getElementById('global-notes-root');
  _ctrl = mountNoteEditor(root, { serverId: null });
  overlay.style.display = 'flex';
  setTimeout(() => box.classList.add('active'), 10);
}

export function closeGlobalNotes() {
  const overlay = document.getElementById('global-notes-modal');
  const box = document.getElementById('global-notes-box');
  if (!overlay || !box) return;
  _ctrl?.flush?.();   // persist any unsaved edits before closing
  box.classList.remove('active');
  overlay.style.display = 'none';
  _ctrl = null;
}
