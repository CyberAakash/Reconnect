module.exports = {
  apps: [
    {
      name: 'reconnect',
      script: 'server.js',
      // Pin to Node 20 — better-sqlite3's native binding is built for ABI 115.
      // The default `node` on PATH is Zed's v24 (ABI 137) and will fail to dlopen.
      interpreter: '/Users/aakash-22269/.nvm/versions/node/v20.19.4/bin/node',
      cwd: '/Users/aakash-22269/Zoho/Tools/REConnect',
      // Original setup ran on 8899; server.js defaults to 9898 without this.
      env: { PORT: 8899 },
      // Guard against crash-loop storms (was at 282k restarts before this fix).
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
