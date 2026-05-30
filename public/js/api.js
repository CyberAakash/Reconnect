import { icon } from './icons.js';

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return new Promise(() => {}); // halt — navigation in progress
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setBtnLoading(btn, loading, originalHTML) {
  if (loading) {
    btn._orig = btn.innerHTML;
    btn.innerHTML = `<span class="rt-spinner">${icon('spinner', 14)}</span>`;
    btn.disabled = true;
  } else {
    btn.innerHTML = originalHTML || btn._orig || btn.innerHTML;
    btn.disabled = false;
  }
}
