import { STATE } from '../state.js';
import { icon } from '../icons.js';
import { api, esc, setBtnLoading } from '../api.js';
import { toast } from '../ui/toast.js';
import { confirm } from '../ui/confirm.js';
import { appendOutput, setOutputPanel, loadOutputForServer } from '../ui/outputPanel.js';
import { ensureMonaco } from '../monaco.js';
import { langFor, currentMonacoTheme } from '../monaco.js';
import { applyEditorTheme } from '../theme.js';

export function renderFilesTab() {
  const id = STATE.selectedId;
  if (!id) return;
  if (window.innerWidth <= 768 && STATE.fileTreeOpen) toggleFileTree(false);
  renderEditorTabs();
  loadFileTree();
  loadSavedFiles();
}

export async function loadFileTree(path) {
  const id = STATE.selectedId;
  if (!id) return;
  const pathInput  = document.getElementById('tree-path-input');
  const currentPath = path || pathInput?.value || '/home/sas/source_compile/';
  if (pathInput) pathInput.value = currentPath;
  renderBreadcrumbs(currentPath);
  try {
    const data = await api(`/api/servers/${id}/file/list`, { method: 'POST', body: { path: currentPath } });
    renderFileTree(data.entries || data || [], currentPath);
  } catch (e) {
    const tree = document.getElementById('file-tree');
    if (tree) tree.innerHTML = `<div class="rt-tree-error">Cannot list directory: ${esc(e.message)}</div>`;
  }
}

function renderBreadcrumbs(path) {
  const nav = document.getElementById('tree-breadcrumbs');
  if (!nav) return;
  nav.innerHTML = '';
  const clean    = path.replace(/\/$/, '');
  const segments = clean.split('/').filter(s => s !== '');

  const rootBtn = document.createElement('button');
  rootBtn.className = 'rt-crumb';
  rootBtn.textContent = '/';
  rootBtn.title = '/';
  rootBtn.addEventListener('click', () => loadFileTree('/'));
  nav.appendChild(rootBtn);

  let accumulated = '';
  segments.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'rt-crumb-sep';
    sep.innerHTML = icon('chevronRight', 10);
    nav.appendChild(sep);
    accumulated += '/' + seg;
    const isLast = i === segments.length - 1;
    const crumb = document.createElement('button');
    crumb.className = 'rt-crumb' + (isLast ? ' current' : '');
    crumb.textContent = seg;
    crumb.title = accumulated + '/';
    if (!isLast) {
      const dest = accumulated + '/';
      crumb.addEventListener('click', () => loadFileTree(dest));
    } else {
      crumb.disabled = true;
    }
    nav.appendChild(crumb);
  });
  nav.scrollLeft = nav.scrollWidth;
}

function parentPath(p) {
  const stripped = p.replace(/\/$/, '');
  const idx = stripped.lastIndexOf('/');
  if (idx <= 0) return '/';
  return stripped.slice(0, idx) + '/';
}

function renderFileTree(entries, basePath) {
  const tree = document.getElementById('file-tree');
  if (!tree) return;
  tree.innerHTML = '';

  if (basePath && basePath !== '/') {
    const upRow = document.createElement('div');
    upRow.className = 'rt-tree-row';
    upRow.setAttribute('role', 'listitem');
    upRow.setAttribute('tabindex', '0');
    upRow.innerHTML = `<span class="rt-tree-ico">${icon('levelUp', 13)}</span><span class="rt-tree-name"><span class="rt-tree-name-inner" style="color:var(--rt-fg-muted)">../</span></span>`;
    upRow.addEventListener('click', () => loadFileTree(parentPath(basePath)));
    upRow.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadFileTree(parentPath(basePath)); } });
    tree.appendChild(upRow);
  }

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'rt-tree-empty';
    empty.textContent = 'Empty directory';
    tree.appendChild(empty);
    return;
  }

  entries.forEach(e => { if (e.type == null) e.type = e.isDir ? 'directory' : 'file'; });
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });

  entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'rt-tree-row';
    row.setAttribute('role', 'listitem');
    row.setAttribute('tabindex', '0');
    const fullPath = basePath.replace(/\/$/, '') + '/' + entry.name;

    if (entry.type === 'directory') {
      row.innerHTML = `<span class="rt-tree-ico">${icon('folder', 13)}</span><span class="rt-tree-name"><span class="rt-tree-name-inner">${esc(entry.name)}/</span></span>`;
      row.addEventListener('click', () => loadFileTree(fullPath + '/'));
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadFileTree(fullPath + '/'); } });
    } else {
      if (fullPath === STATE.activeFilePath) row.classList.add('active');
      row.innerHTML = `
        <span class="rt-tree-ico">${icon('file', 13)}</span>
        <span class="rt-tree-name"><span class="rt-tree-name-inner">${esc(entry.name)}</span></span>
        <span class="rt-tree-size">${entry.size != null ? formatSize(entry.size) : ''}</span>
      `;
      row.addEventListener('click', () => openFile(fullPath));
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(fullPath); } });
    }

    const nameEl  = row.querySelector('.rt-tree-name');
    const innerEl = row.querySelector('.rt-tree-name-inner');
    function startMarquee() {
      if (!nameEl || !innerEl) return;
      const overflow = innerEl.scrollWidth - nameEl.clientWidth;
      if (overflow > 4) {
        innerEl.style.setProperty('--rt-marquee-shift', `-${overflow}px`);
        innerEl.classList.add('marquee');
      }
    }
    function stopMarquee() {
      if (!innerEl) return;
      innerEl.classList.remove('marquee');
      innerEl.style.removeProperty('--rt-marquee-shift');
    }
    row.addEventListener('mouseenter', startMarquee);
    row.addEventListener('mouseleave', stopMarquee);
    row.addEventListener('focus', startMarquee);
    row.addEventListener('blur', stopMarquee);
    tree.appendChild(row);
  });

  const activeRow = tree.querySelector('.rt-tree-row.active');
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function revealActiveFile() {
  if (!STATE.activeFilePath || !STATE.selectedId) return;
  const dir = parentPath(STATE.activeFilePath);
  const pathInput = document.getElementById('tree-path-input');
  const currentPath = pathInput ? pathInput.value : null;
  if (currentPath === dir) {
    const activeRow = document.querySelector('#file-tree .rt-tree-row.active');
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
  } else {
    loadFileTree(dir);
  }
}

export async function openFile(path) {
  const id = STATE.selectedId;
  if (!id) return;
  if (STATE.openFiles.find(f => f.path === path)) { setActiveFile(path); return; }
  try {
    const data = await api(`/api/servers/${id}/file/read`, { method: 'POST', body: { path } });
    STATE.openFiles.push({ path, content: data.content || '', dirty: false });
    setActiveFile(path);
    renderEditorTabs();
  } catch (e) {
    toast('Cannot open file: ' + e.message, 'error');
  }
}

function setActiveFile(path) {
  STATE.activeFilePath = path;
  renderEditorTabs();
  renderEditor();
  if (STATE.selectedId && STATE.centerTab === 'files') revealActiveFile();
}

export function renderEditorTabs() {
  const tabs = document.getElementById('editor-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';

  const toggle = document.createElement('button');
  toggle.className = 'rt-etab-toggle';
  toggle.id = 'editor-tree-toggle';
  toggle.title = STATE.fileTreeOpen ? 'Hide explorer' : 'Show explorer';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.innerHTML = icon(STATE.fileTreeOpen ? 'chevronLeft' : 'folder', 14);
  toggle.addEventListener('click', () => toggleFileTree(!STATE.fileTreeOpen));
  tabs.appendChild(toggle);

  STATE.openFiles.forEach(f => {
    const btn  = document.createElement('button');
    btn.className = 'rt-etab' + (f.path === STATE.activeFilePath ? ' active' : '');
    btn.setAttribute('role', 'tab');
    const name = f.path.split('/').pop();
    btn.innerHTML = `${esc(name)}${f.dirty ? '<span class="rt-etab-dot"></span>' : ''}<span class="rt-etab-close">${icon('close', 10)}</span>`;
    btn.addEventListener('click', e => {
      if (e.target.closest('.rt-etab-close')) { closeFile(f.path); return; }
      setActiveFile(f.path);
    });
    tabs.appendChild(btn);
  });
}

export async function closeFile(path) {
  const f = STATE.openFiles.find(f => f.path === path);
  if (f?.dirty) {
    const ok = await confirm('Unsaved changes', `Close "${path.split('/').pop()}" without saving?`, 'Discard', true);
    if (!ok) return;
  }
  STATE.openFiles = STATE.openFiles.filter(f => f.path !== path);
  if (STATE.activeFilePath === path) {
    STATE.activeFilePath = STATE.openFiles.length ? STATE.openFiles[STATE.openFiles.length - 1].path : null;
  }
  const model = STATE.models.get(path);
  if (model) { model.dispose(); STATE.models.delete(path); }
  renderEditorTabs();
  renderEditor();
}

function editorResponsiveOptions() {
  const isMobile = window.innerWidth <= 768;
  return { lineNumbers: isMobile ? 'off' : 'on', minimap: { enabled: !isMobile } };
}

export async function renderEditor() {
  const f           = STATE.openFiles.find(f => f.path === STATE.activeFilePath);
  const editorEmpty = document.getElementById('editor-empty');
  const codeScroll  = document.getElementById('code-scroll');
  const toolbar     = document.getElementById('editor-toolbar');
  const fname       = document.getElementById('editor-fname');
  const langPill    = document.getElementById('editor-lang');
  const saveBtn     = document.getElementById('save-btn');

  if (!f) {
    editorEmpty.style.display = 'flex';
    codeScroll.style.display  = 'none';
    toolbar.style.display     = 'none';
    return;
  }

  editorEmpty.style.display = 'none';
  codeScroll.style.display  = 'block';
  toolbar.style.display     = 'flex';
  fname.textContent = f.path.split('/').pop();
  if (langPill) {
    const lang = langFor(f.path);
    langPill.textContent = lang;
    langPill.className = 'rt-status-pill';
  }
  if (saveBtn) saveBtn.disabled = !f.dirty;
  updateBookmarkBtn();

  const monaco = await ensureMonaco();

  if (!STATE.monaco) {
    STATE.monaco = monaco.editor.create(document.getElementById('monaco-host'), {
      automaticLayout: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--rt-mono').trim() || 'JetBrains Mono, monospace',
      fontSize: 13,
      lineHeight: 20,
      ...editorResponsiveOptions(),
      scrollBeyondLastLine: false,
      theme: currentMonacoTheme(),
      wordWrap: 'off',
      renderWhitespace: 'selection',
      smoothScrolling: true,
    });
    applyEditorTheme();
  }

  let model = STATE.models.get(f.path);
  if (!model) {
    model = monaco.editor.createModel(f.content, langFor(f.path), monaco.Uri.file(f.path));
    STATE.models.set(f.path, model);
    model.onDidChangeContent(() => {
      const file = STATE.openFiles.find(x => x.path === f.path);
      if (!file) return;
      file.content = model.getValue();
      file.dirty   = true;
      const sb = document.getElementById('save-btn');
      if (sb) sb.disabled = false;
      renderEditorTabs();
    });
  }

  STATE.monaco.setModel(model);
  STATE.monaco.focus();
}

export async function saveActiveFile() {
  const f = STATE.openFiles.find(f => f.path === STATE.activeFilePath);
  if (!f) return;
  const id      = STATE.selectedId;
  const saveBtn = document.getElementById('save-btn');
  setBtnLoading(saveBtn, true);
  try {
    await api(`/api/servers/${id}/file/write`, { method: 'POST', body: { path: f.path, content: f.content } });
    f.dirty = false;
    setBtnLoading(saveBtn, false, `${icon('save', 13)} <span class="rt-btn-txt">Save</span>`);
    saveBtn.disabled = true;
    renderEditorTabs();
    toast(`Saved ${f.path.split('/').pop()}`);
  } catch (e) {
    setBtnLoading(saveBtn, false, `${icon('save', 13)} <span class="rt-btn-txt">Save</span>`);
    toast('Save failed: ' + e.message, 'error');
  }
}

export async function compileActiveFile() {
  const f = STATE.openFiles.find(f => f.path === STATE.activeFilePath);
  if (!f) return;
  const id = STATE.selectedId;
  if (STATE.serverStatus[id] !== 'connected') { toast('Must be connected to compile', 'error'); return; }
  const filename = f.path.split('/').pop();
  const cmd      = `cd source_compile && sh compile.sh ${filename}`;
  const compBtn  = document.getElementById('compile-btn');
  setBtnLoading(compBtn, true);
  appendOutput(id, { type: 'cmd', text: cmd, ts: Date.now() });
  if (!STATE.panelOpen) setOutputPanel(true);
  loadOutputForServer(id);

  const sse = new EventSource(`/api/servers/${id}/exec?cmd=${encodeURIComponent(cmd)}`);
  sse.onmessage = e => {
    let data; try { data = JSON.parse(e.data); } catch { data = { type: 'stdout', data: e.data }; }
    const text = data.data || data.message || '';
    if (data.type === 'stdout' || data.type === 'stderr') {
      appendOutput(id, { type: data.type, text, ts: Date.now() });
    } else if (data.type === 'exit') {
      appendOutput(id, { type: 'exit', code: data.code ?? 0, ts: Date.now() });
      setBtnLoading(compBtn, false, `${icon('compile', 13)} <span class="rt-btn-txt">Compile</span>`);
      sse.close();
      if (data.code === 0) toast('Compiled successfully');
      else toast('Compile failed (exit ' + data.code + ')', 'error');
      if (STATE.selectedId === id) loadOutputForServer(id);
    }
  };
  sse.onerror = () => {
    setBtnLoading(compBtn, false, `${icon('compile', 13)} <span class="rt-btn-txt">Compile</span>`);
    sse.close();
  };
}

export async function deleteActiveFile() {
  const f = STATE.openFiles.find(f => f.path === STATE.activeFilePath);
  if (!f) return;
  await deleteRemoteFile(f.path);
}

async function deleteRemoteFile(path) {
  const ok = await confirm('Delete file?', `Delete "${path.split('/').pop()}"? This cannot be undone.`, 'Delete', true);
  if (!ok) return;
  const id = STATE.selectedId;
  try {
    await api(`/api/servers/${id}/file/delete`, { method: 'POST', body: { path } });
    toast('Deleted ' + path.split('/').pop());
    STATE.openFiles = STATE.openFiles.filter(f => f.path !== path);
    if (STATE.activeFilePath === path) {
      STATE.activeFilePath = STATE.openFiles.length ? STATE.openFiles[STATE.openFiles.length - 1].path : null;
    }
    renderEditorTabs();
    renderEditor();
    loadFileTree();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}

export async function createNewFile() {
  const pathInput = document.getElementById('tree-path-input');
  const dir  = pathInput?.value || '/home/sas/source_compile/';
  const name = window.prompt('New file name:', 'untitled.sh');
  if (!name) return;
  const fullPath = dir.replace(/\/$/, '') + '/' + name;
  const id = STATE.selectedId;
  try {
    await api(`/api/servers/${id}/file/write`, { method: 'POST', body: { path: fullPath, content: '' } });
    await loadFileTree();
    openFile(fullPath);
  } catch (e) {
    toast('Cannot create file: ' + e.message, 'error');
  }
}

export function initFileUpload() {
  const input = document.getElementById('file-upload-input');
  const btn   = document.getElementById('upload-btn');
  if (!input || !btn) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const id = STATE.selectedId;
    const pathInput = document.getElementById('tree-path-input');
    const dir = pathInput?.value || '/home/sas/source_compile/';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', dir);
    try {
      const res = await fetch(`/api/servers/${id}/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(`Uploaded ${file.name}`);
      await loadFileTree();
    } catch (e) {
      toast('Upload failed: ' + e.message, 'error');
    }
    input.value = '';
  });
}

export function toggleBookmarksDrawer(force) {
  const drawer = document.getElementById('saved-drawer');
  const btn    = document.getElementById('toggle-bookmarks-btn');
  if (!drawer) return;
  const open = force !== undefined ? !!force : !STATE.bookmarksOpen;
  STATE.bookmarksOpen = open;
  if (open) {
    drawer.removeAttribute('hidden');
    requestAnimationFrame(() => drawer.classList.add('open'));
  } else {
    drawer.classList.remove('open');
    drawer.addEventListener('transitionend', () => {
      if (!STATE.bookmarksOpen) drawer.setAttribute('hidden', '');
    }, { once: true });
  }
  if (btn) btn.classList.toggle('active', open);
}

export async function loadSavedFiles() {
  try {
    STATE.savedFiles = await api('/api/files');
    renderBookmarks();
    updateBookmarkBtn();
  } catch (e) { /* ignore */ }
}

function renderBookmarks() {
  const chips   = document.getElementById('saved-chips');
  const countEl = document.getElementById('saved-count');
  if (!chips) return;
  chips.innerHTML = '';
  if (countEl) countEl.textContent = STATE.savedFiles.length > 0 ? String(STATE.savedFiles.length) : '';
  if (!STATE.savedFiles.length) {
    const empty = document.createElement('div');
    empty.className = 'rt-saved-empty';
    empty.textContent = 'No saved files yet.\nBookmark a file via the toolbar.';
    chips.appendChild(empty);
    return;
  }
  STATE.savedFiles.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'rt-saved-chip rt-corner-host';
    chip.title = f.path;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'rt-saved-chip-name';
    nameSpan.textContent = f.label || f.path.split('/').pop() || f.path;
    const cornerActions = document.createElement('span');
    cornerActions.className = 'rt-corner-actions';
    const xBtn = document.createElement('button');
    xBtn.className = 'rt-corner-btn del';
    xBtn.innerHTML = icon('close', 11);
    xBtn.title = 'Remove bookmark';
    xBtn.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await api(`/api/files/${f.id}`, { method: 'DELETE' });
        await loadSavedFiles();
        updateBookmarkBtn();
      } catch (err) {
        toast('Bookmark error: ' + err.message, 'error');
      }
    });
    cornerActions.appendChild(xBtn);
    chip.appendChild(nameSpan);
    chip.appendChild(cornerActions);
    chip.addEventListener('click', () => { openFile(f.path); toggleBookmarksDrawer(false); });
    chips.appendChild(chip);
  });
}

export function updateBookmarkBtn() {
  const btn = document.getElementById('bookmark-file-btn');
  if (!btn) return;
  const path  = STATE.activeFilePath;
  const saved = path && STATE.savedFiles.find(f => f.path === path);
  btn.innerHTML = icon('bookmark', 14);
  btn.title = saved ? 'Remove bookmark' : 'Bookmark this file';
  btn.classList.toggle('active', !!saved);
  btn.style.color = saved ? 'var(--rt-accent)' : '';
}

export async function toggleBookmark() {
  const path = STATE.activeFilePath;
  if (!path) return;
  const existing = STATE.savedFiles.find(f => f.path === path);
  try {
    if (existing) {
      await api(`/api/files/${existing.id}`, { method: 'DELETE' });
    } else {
      const label = path.split('/').pop();
      await api('/api/files', { method: 'POST', body: { label, path } });
    }
    await loadSavedFiles();
    updateBookmarkBtn();
  } catch (e) {
    toast('Bookmark error: ' + e.message, 'error');
  }
}

export function toggleFileTree(open) {
  STATE.fileTreeOpen = open;
  document.getElementById('tree-pane').style.display = open ? '' : 'none';
  renderEditorTabs();
}

export function editorResponsiveResize() {
  if (STATE.monaco) STATE.monaco.updateOptions(editorResponsiveOptions());
}
