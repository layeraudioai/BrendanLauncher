'use strict';
const http = require('node:http');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT environment variable is required');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
    return res.end(JSON.stringify({ok: true, app: process.env.BRENDAN_WEBAPP_ID}));
  }
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff'});
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hello Node</title><main><h1>Hello from a Node.js web app</h1><p>Served at <code>${host}:${port}</code> by a child process managed by BrendanLauncher.</p><p>This page runs in your desktop browser; it is not a console-native app.</p><a href="/health">Check app health</a></main><style>body{margin:0;background:#101510;color:#eaf2e8;font:16px system-ui}main{max-width:680px;margin:12vh auto;padding:32px;border:1px solid #344432;border-radius:16px}code{color:#a7ff68}</style>`);
});
server.listen(port, host, () => console.log(`Hello Node listening on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
