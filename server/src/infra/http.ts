import express from 'express';
import cors from 'cors';
import http from 'http';

export function createHttpApp() {
  const app = express();
  app.use(cors());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const httpServer = http.createServer(app);
  return { app, httpServer };
}
