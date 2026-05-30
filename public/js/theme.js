import { icon } from './icons.js';
import { currentMonacoTheme } from './monaco.js';

/* ============================= EDITOR THEME ============================= */
export const EDITOR_THEMES = {
  auto:             { m: null,              cdn: null },
  light:            { m: 'vs',             cdn: null },
  dark:             { m: 'vs-dark',        cdn: null },
  dracula:          { m: 'dracula',        cdn: 'Dracula' },
  monokai:          { m: 'monokai',        cdn: 'Monokai' },
  'solarized-dark': { m: 'solarized-dark', cdn: 'Solarized-dark' },
  github:           { m: 'github',         cdn: 'GitHub' },
  'night-owl':      { m: 'night-owl',      cdn: 'Night Owl' },
};
const _definedMonacoThemes = new Set();

export async function ensureMonacoTheme(id) {
  const def = EDITOR_THEMES[id];
  if (!def) return currentMonacoTheme();
  if (!def.cdn) return def.m;                       // built-in: vs / vs-dark
  if (_definedMonacoThemes.has(id)) return def.m;   // already loaded
  try {
    const url = `https://cdn.jsdelivr.net/npm/monaco-themes@0.4.4/themes/${encodeURIComponent(def.cdn)}.json`;
    const data = await (await fetch(url)).json();
    window.monaco.editor.defineTheme(def.m, data);
    _definedMonacoThemes.add(id);
  } catch (e) {
    console.warn('Failed to load monaco theme', id, e);
    return currentMonacoTheme();
  }
  return def.m;
}

export function resolvedEditorThemeId() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'light';
}

export async function applyEditorTheme() {
  if (!window.monaco) return;
  const mId = await ensureMonacoTheme(resolvedEditorThemeId());
  window.monaco.editor.setTheme(mId);
}

/* ============================= TERMINAL THEME ============================= */
export const TERM_THEME_CLASS = {
  dark:             '',
  light:            'theme-light',
  monokai:          'theme-monokai',
  'solarized-dark': 'theme-solarized-dark',
  dracula:          'theme-dracula',
  github:           'theme-github',
};

export function resolvedTermThemeId() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'light';
}

export function applyTerminalTheme() {
  const mount = document.getElementById('term-xterm');
  if (!mount) return;
  const root = mount.querySelector('.wterm') || mount;
  Object.values(TERM_THEME_CLASS).forEach(c => c && root.classList.remove(c));
  const cls = TERM_THEME_CLASS[resolvedTermThemeId()];
  if (cls) root.classList.add(cls);
}

/* ============================= APP THEME ============================= */
export function initTheme() {
  const saved = localStorage.getItem('rt-theme');
  const sys = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const theme = saved || sys;
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeBtn();
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('rt-theme', next);
  updateThemeBtn();
  applyEditorTheme();
  applyTerminalTheme();
}

export function updateThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const btns = [document.getElementById('rail-theme-btn'), document.getElementById('mb-theme-btn')];
  btns.forEach(btn => { if (btn) btn.innerHTML = icon(dark ? 'sun' : 'moon', 16); });
}
