/* ===== Shared note editor — list + BlockNote island =====
 *
 * Used by BOTH the per-server Notes tab (ui/notes.js) and the global Notes
 * rail section (ui/globalNotes.js). Owns the note list, create/delete, autosave,
 * scope handling — and mounts the BlockNote editor (the only React in the app)
 * as a controlled island via the imperative bridge built by Vite into
 * /notes/notes.js. BlockNote provides the Notion UX (slash menu, drag handles,
 * nested blocks, formatting toolbar) with menus portalled to <body>, so nothing
 * is clipped by the notes panel.
 */
import { STATE, noteScopeKey } from '../state.js';
import { api, esc } from '../api.js';
import { icon } from '../icons.js';
import { toast } from '../ui/toast.js';

const AUTOSAVE_MS = 800;

/* Lazy-load the compiled BlockNote bundle once, on first use. */
let _mounterPromise = null;
function getMounter() {
  if (!_mounterPromise) {
    // Defensive shim: some bundled deps reference the Node `process` global.
    // The build replaces process.env.NODE_ENV, but this covers any residual
    // bare `process` reference so the module evaluates in the browser.
    if (!window.process) window.process = { env: { NODE_ENV: 'production' } };
    _mounterPromise = import('/notes/notes.js')
      .then(m => m.mountBlockEditor)
      .catch((e) => { _mounterPromise = null; throw e; });
  }
  return _mounterPromise;
}

/* Decode the stored `content` string for the island:
 *   - BlockNote block JSON (an array) → passed through as blocks
 *   - anything else (legacy markdown/plain text) → passed as a string, which
 *     the island parses via tryParseMarkdownToBlocks after mount */
function decodeContent(content) {
  if (!content) return undefined;
  try {
    const d = JSON.parse(content);
    if (Array.isArray(d)) return d;
  } catch { /* not BlockNote JSON — treat as markdown/text below */ }
  return content;
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Mount the note editor into `rootEl`.
 * @param {HTMLElement} rootEl
 * @param {{ serverId?: number|null }} opts  serverId omitted/null ⇒ global scope
 */
export function mountNoteEditor(rootEl, { serverId = null } = {}) {
  rootEl._noteEditorCtrl?.destroy?.();

  const scopeKey = noteScopeKey(serverId);
  const listUrl  = serverId == null ? '/api/notes' : `/api/servers/${serverId}/notes`;

  rootEl.innerHTML = `
    <div class="rt-notes-wrap">
      <div class="rt-notes-list">
        <div class="rt-notes-list-head">
          <span class="rt-notes-list-title">Notes</span>
          <button class="rt-btn sm accent rt-note-new">${icon('plus', 13)} <span class="rt-btn-txt">New</span></button>
        </div>
        <div class="rt-notes-items"></div>
      </div>
      <div class="rt-note-editor">
        <div class="rt-note-editor-head">
          <input class="rt-input-el rt-note-title" placeholder="Untitled" autocomplete="off" />
          <span class="rt-note-status"></span>
          <div class="rt-spacer"></div>
          <button class="rt-btn sm rt-note-save" title="Save">${icon('save', 13)}</button>
          <button class="rt-btn sm rt-note-del" title="Delete note">${icon('trash', 13)}</button>
        </div>
        <div class="rt-note-body">
          <div class="rt-note-holder"></div>
        </div>
        <div class="rt-note-empty">
          <p>No note selected.</p>
          <span>Pick a note from the list or create a new one.</span>
        </div>
      </div>
    </div>`;

  const $ = (cls) => rootEl.querySelector(cls);
  const itemsEl   = $('.rt-notes-items');
  const editorEl  = $('.rt-note-editor');
  const emptyEl   = $('.rt-note-empty');
  const bodyEl    = $('.rt-note-body');
  const holderEl  = $('.rt-note-holder');
  const titleEl   = $('.rt-note-title');
  const statusEl  = $('.rt-note-status');

  let saveTimer = null;
  let handle = null;          // BlockNote island handle { getContent, focus, destroy }
  let suppressDirty = false;  // ignore onChange during initial content load
  let mountToken = 0;         // guards against races when switching notes fast

  const notes = () => STATE.notes[scopeKey] || [];
  const activeId = () => STATE.activeNoteId[scopeKey];
  const activeNote = () => notes().find(n => n.id === activeId());

  function setStatus(txt) { statusEl.textContent = txt; }

  function renderList() {
    const arr = notes();
    if (!arr.length) {
      itemsEl.innerHTML = `<div class="rt-notes-empty-list">No notes yet.</div>`;
      return;
    }
    itemsEl.innerHTML = arr.map(n => `
      <button class="rt-note-item ${n.id === activeId() ? 'active' : ''}" data-id="${n.id}">
        <span class="rt-note-item-title">${esc(n.title || 'Untitled')}</span>
        <span class="rt-note-item-time">${relTime(n.updated_at)}</span>
      </button>`).join('');
    itemsEl.querySelectorAll('.rt-note-item').forEach(btn =>
      btn.addEventListener('click', () => openNote(+btn.dataset.id)));
  }

  function destroyEditor() {
    if (handle) { try { handle.destroy(); } catch { /* already gone */ } handle = null; }
    holderEl.innerHTML = '';
  }

  async function createEditor(initial) {
    const token = ++mountToken;
    let mountBlockEditor;
    try {
      mountBlockEditor = await getMounter();
    } catch {
      holderEl.innerHTML = `<div class="rt-notes-empty-list">Editor failed to load. Run <code>npm run build:notes</code> and reload.</div>`;
      return;
    }
    if (token !== mountToken) return; // a newer note opened while we awaited
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    suppressDirty = true;
    handle = mountBlockEditor(holderEl, {
      initial,
      theme,
      onChange: () => { if (!suppressDirty) markDirty(); },
    });
    // Let the initial render + async markdown parse settle before honoring edits.
    setTimeout(() => { if (token === mountToken) suppressDirty = false; }, 600);
  }

  async function renderEditorPane() {
    destroyEditor();
    const n = activeNote();
    if (!n) {
      editorEl.classList.add('empty');
      emptyEl.style.display = 'flex';
      bodyEl.style.display = 'none';
      titleEl.style.display = 'none';
      $('.rt-note-save').style.display = 'none';
      $('.rt-note-del').style.display = 'none';
      setStatus('');
      return;
    }
    editorEl.classList.remove('empty');
    emptyEl.style.display = 'none';
    bodyEl.style.display = 'flex';
    titleEl.style.display = '';
    $('.rt-note-save').style.display = '';
    $('.rt-note-del').style.display = '';
    titleEl.value = n.title || '';
    setStatus('Saved · ' + relTime(n.updated_at));
    await createEditor(decodeContent(n.content));
  }

  async function load() {
    STATE.notesLoading[scopeKey] = true;
    try {
      const data = await api(listUrl);
      STATE.notes[scopeKey] = data;
      if (!data.find(n => n.id === activeId())) {
        STATE.activeNoteId[scopeKey] = data[0]?.id ?? null;
      }
      renderList();
      await renderEditorPane();
    } catch (e) {
      toast('Failed to load notes: ' + e.message, 'error');
    } finally {
      STATE.notesLoading[scopeKey] = false;
    }
  }

  async function openNote(id) {
    if (id === activeId()) return;
    await saveNow();
    STATE.activeNoteId[scopeKey] = id;
    renderList();
    await renderEditorPane();
  }

  async function createNote() {
    await saveNow();
    try {
      const { id } = await api('/api/notes', {
        method: 'POST',
        body: { server_id: serverId, title: 'Untitled', content: '' },
      });
      STATE.notes[scopeKey] = [{ id, server_id: serverId, title: 'Untitled', content: '', updated_at: Date.now() }, ...notes()];
      STATE.activeNoteId[scopeKey] = id;
      renderList();
      await renderEditorPane();
      titleEl.focus();
      titleEl.select();
    } catch (e) {
      toast('Failed to create note: ' + e.message, 'error');
    }
  }

  async function deleteNote() {
    const n = activeNote();
    if (!n) return;
    if (!window.confirm(`Delete note "${n.title || 'Untitled'}"?`)) return;
    clearTimeout(saveTimer);
    STATE.notesDirty = false;   // don't let a pending autosave resurrect it
    try {
      await api(`/api/notes/${n.id}`, { method: 'DELETE' });
      STATE.notes[scopeKey] = notes().filter(x => x.id !== n.id);
      STATE.activeNoteId[scopeKey] = notes()[0]?.id ?? null;
      renderList();
      await renderEditorPane();
      toast('Note deleted');
    } catch (e) {
      toast('Failed to delete note: ' + e.message, 'error');
    }
  }

  function markDirty() {
    STATE.notesDirty = true;
    setStatus('Unsaved…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_MS);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    const n = activeNote();
    if (!n || !STATE.notesDirty || !handle) return;
    const title = titleEl.value.trim() || 'Untitled';
    let content;
    try { content = handle.getContent(); } catch { return; }
    try {
      await api(`/api/notes/${n.id}`, { method: 'PUT', body: { title, content } });
      n.title = title; n.content = content; n.updated_at = Date.now();
      STATE.notesDirty = false;
      renderList();
      setStatus('Saved · just now');
    } catch (e) {
      setStatus('Save failed');
      toast('Failed to save note: ' + e.message, 'error');
    }
  }

  /* ── Wire events ────────────────────────────────────────────────────── */
  $('.rt-note-new').addEventListener('click', createNote);
  $('.rt-note-save').addEventListener('click', saveNow);
  $('.rt-note-del').addEventListener('click', deleteNote);
  titleEl.addEventListener('input', markDirty);
  titleEl.addEventListener('blur', saveNow);

  load();

  function destroy() {
    clearTimeout(saveTimer);
    mountToken++;   // invalidate any in-flight createEditor
    destroyEditor();
    rootEl._noteEditorCtrl = null;
  }

  const ctrl = { flush: saveNow, reload: load, destroy };
  rootEl._noteEditorCtrl = ctrl;
  return ctrl;
}
