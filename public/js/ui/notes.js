/* Per-server Notes tab — mounts the shared note editor scoped to the selected
 * server. Notes are local metadata, so they work whether or not the server has
 * a live SSH session. */
import { STATE } from '../state.js';
import { mountNoteEditor } from '../features/noteEditor.js';

let _ctrl = null;

export function renderServerNotes(serverId) {
  const root = document.getElementById('notes-server-root');
  if (!root) return;
  if (serverId == null) { root.innerHTML = ''; _ctrl = null; return; }
  _ctrl = mountNoteEditor(root, { serverId });
}

/** Flush any pending autosave (e.g. when leaving the tab or server). */
export function flushServerNotes() {
  _ctrl?.flush?.();
}
