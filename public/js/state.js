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
  authMode: 'legacy',
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
