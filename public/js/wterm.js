/* WTerm loader — lazy dynamic import, cached */
let _wtermReady;

export function ensureWterm() {
  if (_wtermReady) return _wtermReady;
  _wtermReady = import('https://esm.sh/@wterm/dom@0.3.0');
  return _wtermReady;
}
