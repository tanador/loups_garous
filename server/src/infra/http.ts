import express from 'express';
import cors from 'cors';
import http from 'http';

// Couche "infra": expose un serveur HTTP pour les vérifications et l'attache Socket.IO.
/// Prépare une application Express minimale exposant un endpoint de santé
/// et retourne à la fois l'instance Express et le serveur HTTP associé.
export function createHttpApp() {
  const app = express();
  app.use(cors());
  // Endpoint simple utilisé par les clients pour vérifier que le serveur répond.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const httpServer = http.createServer(app);
  return { app, httpServer };
}
