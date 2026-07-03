/* BlockNote editor island — the ONLY React in this app.
 *
 * Compiled by Vite into public/notes/notes.js and mounted imperatively by the
 * vanilla noteEditor.js via `mountBlockEditor(el, opts)`. BlockNote gives the
 * Notion UX out of the box: `/` slash menu, drag handles, nested blocks, and a
 * formatting toolbar — all rendered in floating portals on document.body, so
 * they are never clipped by the notes panel's overflow. */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

function Editor({ apiRef, initial, theme, onChange }) {
  // `initial` is either an array of BlockNote blocks (from stored JSON) or a
  // string (legacy markdown/plain text) parsed asynchronously after mount.
  const blocks = Array.isArray(initial) && initial.length ? initial : undefined;
  const editor = useCreateBlockNote(blocks ? { initialContent: blocks } : {});

  useEffect(() => {
    apiRef.current = { getBlocks: () => editor.document, focus: () => { try { editor.focus(); } catch { /* not mounted */ } } };
    if (typeof initial === 'string' && initial.trim()) {
      editor.tryParseMarkdownToBlocks(initial)
        .then((b) => { if (b && b.length) editor.replaceBlocks(editor.document, b); })
        .catch(() => { /* leave the empty doc */ });
    }
    return () => { apiRef.current = null; };
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      theme={theme === 'light' ? 'light' : 'dark'}
      onChange={() => { if (onChange) onChange(); }}
    />
  );
}

/**
 * Mount a controlled BlockNote editor into `el`.
 * @param {HTMLElement} el
 * @param {{ initial?: any[]|string, theme?: 'light'|'dark', onChange?: () => void }} opts
 * @returns {{ getContent: () => string, focus: () => void, destroy: () => void }}
 */
export function mountBlockEditor(el, { initial, theme = 'dark', onChange } = {}) {
  const apiRef = { current: null };
  const root = createRoot(el);
  root.render(<Editor apiRef={apiRef} initial={initial} theme={theme} onChange={onChange} />);
  return {
    getContent: () => JSON.stringify(apiRef.current ? apiRef.current.getBlocks() : []),
    focus: () => apiRef.current?.focus?.(),
    destroy: () => root.unmount(),
  };
}
