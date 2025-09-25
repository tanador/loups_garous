/**
 * Minimal HTTP layer used alongside Socket.IO.
 *
 * The Flutter client mostly relies on realtime sockets, but keeping a tiny
 * Express server alive is useful for health checks (e.g. `GET /healthz`).
 * It also allows us to share the same TCP port between HTTP and Socket.IO.
 */
import express from 'express';
import cors from 'cors';
import http from 'http';

/**
 * Build and return both the Express app and its underlying Node HTTP server.
 */
export function createHttpApp() {
  const app = express();
  app.use(cors());

  // Simple endpoint used by clients/tests to verify the server is reachable.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Connectivity probe used by automation scripts to detect the deployed version.
  app.get('/connectivity', (_req, res) => {
    res.json({
      ok: true,
      service: 'loup_garou_server',
      version: process.env['npm_package_version'] ?? 'dev',
    });
  });

  const httpServer = http.createServer(app);
  return { app, httpServer };
}
