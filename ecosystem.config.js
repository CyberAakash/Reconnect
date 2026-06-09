module.exports = {
  apps: [
    {
      name: 'reconnect',
      script: 'server.js',
      // Runs on the `node` already on PATH (no machine-specific pin). The only
      // native dependency is better-sqlite3 — `npm install` (or `npm rebuild
      // better-sqlite3`) builds its binding for whatever Node you use, so if you
      // switch Node major versions and see ERR_DLOPEN_FAILED, just rebuild.
      // Requires Node >= 20 (see package.json "engines").
      cwd: __dirname,
      // Original setup ran on 8899; server.js defaults to 9898 without this.
      env: { PORT: 8899 },
      // Guard against crash-loop storms (was at 282k restarts before this fix).
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
