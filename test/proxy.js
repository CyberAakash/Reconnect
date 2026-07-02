#!/usr/bin/env node
// Tiny HTTP CONNECT proxy for local testing of REConnect's "internal" transport.
//
// REConnect's internal flow tunnels SSH through an HTTP CONNECT proxy
// (RECONNECT_SSH_PROXY, default 127.0.0.1:3128 — see server.js connectViaProxy).
// In production that's the corporate zero-trust agent; locally this stands in
// for it, forwarding CONNECT to any localhost target (e.g. the ssh-otp
// container published on 127.0.0.1:2223).
//
// Run:  node test/proxy.js            # listens on 127.0.0.1:3128
//       PORT=3130 node test/proxy.js  # custom port
//
// Scope: binds to loopback and only forwards to loopback targets — it is a test
// shim, not a general-purpose proxy. Do not expose it.

const net = require('net');
const http = require('http');

const PORT = Number(process.env.PORT || 3128);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  // Only CONNECT is supported.
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('This proxy only supports CONNECT.\n');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, portStr] = String(req.url).split(':');
  const port = Number(portStr) || 22;

  // Test shim: refuse anything that isn't loopback so this can't be misused.
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const bail = (e) => {
    try { clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${e ? e.message : ''}`); } catch (_) {}
    try { upstream.destroy(); } catch (_) {}
  };
  upstream.on('error', bail);
  clientSocket.on('error', () => { try { upstream.destroy(); } catch (_) {} });
});

server.listen(PORT, HOST, () => {
  console.log(`[test-proxy] HTTP CONNECT proxy on ${HOST}:${PORT} (loopback targets only)`);
});
