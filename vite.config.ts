import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import net from 'net';

function ntripProxyPlugin() {
  const activeSockets = new Map<string, net.Socket>();

  return {
    name: 'ntrip-proxy-middleware',
    configureServer(server: any) {
      server.middlewares.use('/api/ntrip-stream', (req: any, res: any) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          });
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url, 'http://localhost:3000');
        const host = parsedUrl.searchParams.get('host');
        const port = parseInt(parsedUrl.searchParams.get('port') || '2101', 10);
        const mountpoint = (parsedUrl.searchParams.get('mountpoint') || '').replace(/^\//, '');
        const username = parsedUrl.searchParams.get('username') || '';
        const password = parsedUrl.searchParams.get('password') || '';
        const sessionKey = `${host}:${port}/${mountpoint}`;

        // Handle POST for sending GGA sentences
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c: any) => {
            body += c;
          });
          req.on('end', () => {
            const socket = activeSockets.get(sessionKey);
            if (socket && !socket.destroyed) {
              socket.write(body);
              res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.writeHead(404, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({ error: 'No active NTRIP socket for session' }));
            }
          });
          return;
        }

        if (!host || !mountpoint) {
          res.writeHead(400, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'Missing host or mountpoint' }));
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
                  'Access-Control-Allow-Origin': '*',
                  'Content-Type': 'text/plain',
                });
                res.end(`Caster rejected: ${headerStr.trim()}`);
                socket.destroy();
                activeSockets.delete(sessionKey);
                return;
              }

              res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
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
              'Access-Control-Allow-Origin': '*',
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
  plugins: [react(), ntripProxyPlugin()],
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
