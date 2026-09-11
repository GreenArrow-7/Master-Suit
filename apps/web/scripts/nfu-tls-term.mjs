/** Minimal TLS terminator: the session cookie is `secure` under NODE_ENV=production. */
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
const opts = { key: readFileSync('infra/tls-local/https.key'), cert: readFileSync('infra/tls-local/https.pem') };
createServer(opts, (req, res) => {
  const up = request(
    {
      host: '127.0.0.1',
      port: 3320,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' },
    },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(up);
}).listen(3443, '127.0.0.1', () => console.log('tls terminator on https://127.0.0.1:3443 -> 3320'));
