/* Monaco editor loader + helpers */
const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/';
let _monacoReady;

export function ensureMonaco() {
  if (_monacoReady) return _monacoReady;
  _monacoReady = new Promise(resolve => {
    self.MonacoEnvironment = {
      getWorkerUrl: () =>
        `data:text/javascript;charset=utf-8,` + encodeURIComponent(
          `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}'};` +
          `importScripts('${MONACO_BASE}vs/base/worker/workerMain.js');`
        )
    };
    require.config({ paths: { vs: MONACO_BASE + 'vs' } });
    require(['vs/editor/editor.main'], () => resolve(window.monaco));
  });
  return _monacoReady;
}

export function langFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', md: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    rb: 'ruby', go: 'go', rs: 'rust', kt: 'kotlin', swift: 'swift',
    php: 'php', r: 'r', m: 'objective-c',
  }[ext] || 'plaintext';
}

export function currentMonacoTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
}
