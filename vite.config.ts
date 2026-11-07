import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import net from 'net';
import fs from 'fs';

/**
 * Stamps a build ID into dist/sw.js, so each deploy gets its own app-shell cache and the worker can delete the
 * previous deploy's cached bundles when it activates.
 */
function serviceWorkerVersionPlugin() {
  let outDir = 'dist';
  return {
    name: 'sw-build-version',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      const id = Date.now().toString(36);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('__BUILD_ID__').join(id));
    },
  };
}

function ntripProxyPlugin() {
  const activeSockets = new Map<string, net.Socket>();
  const ALLOWED_PORTS = new Set([2101, 2102, 2103, 2104, 2105]);

  return {
    name: 'ntrip-proxy-middleware',
    configureServer(server: any) {
      server.middlewares.use('/api/ntrip-stream', (req: any, res: any) => {
        // 1. Restrict client to localhost (reject external Wi-Fi clients trying to use dev server as TCP relay)
        const remoteIp = req.socket.remoteAddress || '';
        const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
        if (!isLoopback) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: NTRIP proxy only accessible from localhost' }));
          return;
        }

        // 2. Validate Origin header: only allow localhost / 127.0.0.1 origins
        const origin = req.headers['origin'];
        const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
        if (origin && !allowedOriginPattern.test(origin)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Invalid origin' }));
          return;
        }
        const corsOrigin = origin || 'http://localhost:5173';

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Ntrip-Version, User-Agent',
          });
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url, 'http://localhost:3000');
        const host = parsedUrl.searchParams.get('host') || '';
        const port = parseInt(parsedUrl.searchParams.get('port') || '2101', 10);
        const mountpoint = (parsedUrl.searchParams.get('mountpoint') || '').replace(/^\//, '');
        const username = parsedUrl.searchParams.get('username') || '';
        const password = parsedUrl.searchParams.get('password') || '';
        const sessionKey = `${host}:${port}/${mountpoint}`;

        // 3. Port allowlist check (prevent arbitrary port scanning / local intranet service relay)
        if (!ALLOWED_PORTS.has(port)) {
          res.writeHead(400, {
            'Access-Control-Allow-Origin': corsOrigin,
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: `Port ${port} not permitted. Allowed NTRIP caster ports: 2101-2105` }));
          return;
        }

        // 4. Validate host and mountpoint (prevent CRLF injection and path traversal)
        const hostRegex = /^[a-zA-Z0-9.-]+$/;
        const mountpointRegex = /^[a-zA-Z0-9_\-\.]{1,64}$/;
        if (!host || !hostRegex.test(host) || !mountpoint || !mountpointRegex.test(mountpoint)) {
          res.writeHead(400, {
            'Access-Control-Allow-Origin': corsOrigin,
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'Invalid host or mountpoint format' }));
          return;
        }

        // 5. Handle POST for sending GGA sentences: validate NMEA sentence format and drop raw POST write
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c: any) => {
            body += c;
            if (body.length > 256) {
              req.destroy();
            }
          });
          req.on('end', () => {
            const trimmedBody = body.trim();
            if (!/^\$G[A-Z]{4},[ -~]{1,120}$/.test(trimmedBody)) {
              res.writeHead(400, {
                'Access-Control-Allow-Origin': corsOrigin,
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({ error: 'Invalid GGA NMEA sentence format' }));
              return;
            }

            const socket = activeSockets.get(sessionKey);
            if (socket && !socket.destroyed) {
              socket.write(trimmedBody + '\r\n');
              res.writeHead(200, {
                'Access-Control-Allow-Origin': corsOrigin,
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.writeHead(404, {
                'Access-Control-Allow-Origin': corsOrigin,
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({ error: 'No active NTRIP socket for session' }));
            }
          });
          return;
        }

        let authHeader = '';
        if (username || password) {
          const auth = Buffer.from(`${username}:${password}`).toString('base64');
          authHeader = `Authorization: Basic ${auth}\r\n`;
        }

        const socket = net.createConnection({ host, port }, () => {
          const reqStr = `GET /${mountpoint} HTTP/1.0\r\nUser-Agent: NTRIP MavlinkGlareshield/1.0\r\n${authHeader}\r\n`;
          socket.write(reqStr);
        });

        activeSockets.set(sessionKey, socket);

        let headerParsed = false;
        let headerBuf = Buffer.alloc(0);

        socket.on('data', (chunk) => {
          if (!headerParsed) {
            headerBuf = Buffer.concat([headerBuf, chunk]);
            let splitAt = -1;
            const doubleCrlf = headerBuf.indexOf('\r\n\r\n');
            const icyIdx = headerBuf.indexOf('ICY 200 OK\r\n');

            if (doubleCrlf !== -1) {
              splitAt = doubleCrlf + 4;
            } else if (icyIdx !== -1) {
              splitAt = icyIdx + 12;
            }

            if (splitAt !== -1) {
              headerParsed = true;
              const headerStr = headerBuf.slice(0, splitAt).toString('utf-8');

              if (!headerStr.includes('200 OK')) {
                res.writeHead(401, {
                  'Access-Control-Allow-Origin': corsOrigin,
                  'Content-Type': 'text/plain',
                });
                res.end(`Caster rejected: ${headerStr.trim()}`);
                socket.destroy();
                activeSockets.delete(sessionKey);
                return;
              }

              res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Access-Control-Allow-Origin': corsOrigin,
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              });

              const bodyRemaining = headerBuf.slice(splitAt);
              if (bodyRemaining.length > 0) {
                res.write(bodyRemaining);
              }
            }
          } else {
            res.write(chunk);
          }
        });

        socket.on('error', (err) => {
          activeSockets.delete(sessionKey);
          if (!headerParsed) {
            res.writeHead(502, {
              'Access-Control-Allow-Origin': corsOrigin,
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ error: `Connection to ${host}:${port} failed: ${err.message}` }));
          } else {
            res.end();
          }
        });

        socket.on('close', () => {
          activeSockets.delete(sessionKey);
          res.end();
        });

        req.on('close', () => {
          socket.destroy();
          activeSockets.delete(sessionKey);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ntripProxyPlugin(), serviceWorkerVersionPlugin()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@diffusionstudio/vits-web', 'onnxruntime-web'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
  },
});
