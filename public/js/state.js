/* STATE singleton — shared mutable state across all modules */
export const STATE = {
  servers: [],
  selectedId: null,
  serverStatus: {},  // id -> 'connected' | 'connecting' | 'disconnected'
  centerTab: 'overview',
  panelOpen: false,
  panelHeight: parseInt(localStorage.getItem('rt-panel-h') || '300', 10),
  outputs: {},       // id -> array of output entries
  savedCommands: [],
  savedFiles: [],
  authMode: 'otp',      // global default auth mode: key | password | otp (used when scope === 'global')
  authScope: 'global',  // config scope: 'global' (defaults rule all) | 'standalone' (per-server)
  defaultMethod: 'internal',     // global default transport
  defaultExplorer: 'onechannel', // global default explorer
  defaultTerminal: 'console',    // global default terminal
  sidebarCollapsed: localStorage.getItem('rt-sidebar-collapsed') === '1',
  mobileNavOpen: false,
  sseConnections: {},   // id -> EventSource
  termHistory: [],
  termHistIdx: -1,
  termRunning: false,
  termWs: null,         // active WebSocket for PTY shell (legacy mode)
  xtermInst: null,      // WTerm instance
  termConsole: false,   // OTP mode: terminal is a native DOM command console, not a live PTY
  termConsoleSse: null, // OTP mode: in-flight /exec EventSource
  _termConsoleEls: null, // OTP mode: { out, inputRow, input } DOM refs for the console
  _consoleExternal: null, // OTP mode: paste a command into the console input (quick commands)

  openFiles: [],       // { path, content, dirty }
  activeFilePath: null,
  fileTreeOpen: true,
  bookmarksOpen: false,
  quickOpen: false,
  _editingCommandId: null,
  detailsOpen: true,
  sysInfo: {},         // id -> parsed sysinfo object (null = unavailable)
  sysInfoLoading: {},  // id -> boolean
  monaco: null,        // monaco editor instance (singleton)
  models: new Map(),   // path -> monaco.editor.ITextModel
};

/**
 * Effective auth mode ('key' | 'password' | 'otp') for a given server.
 * The server annotates each list entry with `effective_auth_mode` (resolved
 * from scope + per-server flow); fall back to the global default if absent.
 */
export function effectiveAuthMode(id) {
  const s = STATE.servers.find(sv => sv.id === id);
  return (s && s.effective_auth_mode) || STATE.authMode;
}

/**
 * Transport for a server: true = internal (zero-trust proxy + single-shell RPC
 * console + base64 file ops), false = external (direct SSH, live PTY + SFTP).
 * Drives the channel-mode gating in the UI. Defaults to internal when unknown.
 */
export function isInternal(id) {
  const s = STATE.servers.find(sv => sv.id === id);
  return !s || (s.effective_connection_method || s.connection_method) !== 'external';
}

/**
 * Effective explorer mode ('sftp' | 'onechannel') for a server — the server
 * annotates each list entry with `effective_explorer_mode` (scope- and
 * feasibility-resolved). Falls back to the global default.
 */
export function effectiveExplorerMode(id) {
  const s = STATE.servers.find(sv => sv.id === id);
  return (s && s.effective_explorer_mode) || STATE.defaultExplorer;
}

/** Effective terminal mode ('pty' | 'console') for a server. */
export function effectiveTerminalMode(id) {
  const s = STATE.servers.find(sv => sv.id === id);
  return (s && s.effective_terminal_mode) || STATE.defaultTerminal;
}
