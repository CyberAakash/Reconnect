import { STATE } from '../state.js';
import { icon } from '../icons.js';

const STATUS_INFO = {
  connecting:    { label: 'Connecting…',   cls: 'connecting',    ico: 'spinner'     },
  ready:         { label: 'Connected',      cls: 'connected',     ico: 'connect'     },
  connected:     { label: 'Connected',      cls: 'connected',     ico: 'connect'     },
  disconnected:  { label: 'Disconnected',   cls: 'disconnected',  ico: 'disconnect'  },
  error:         { label: 'Error',          cls: 'error',         ico: 'alert'       },
  timeout:       { label: 'Timeout',        cls: 'error',         ico: 'alert'       },
};

export function updateStatusPill(serverId) {
  const status = STATE.serverStatus[serverId] || 'disconnected';
  const info = STATUS_INFO[status] || STATUS_INFO.disconnected;
  const pill = document.getElementById('status-pill');
  const dot  = document.getElementById('status-dot');
  const txt  = document.getElementById('status-text');
  if (!pill) return;
  pill.className = `rt-status-pill ${info.cls}`;
  dot.innerHTML = icon(info.ico, 12);
  txt.textContent = info.label;
}
