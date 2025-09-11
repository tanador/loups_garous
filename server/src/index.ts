import { createHttpApp } from './infra/http.js';
import { createSocketServer } from './infra/socket.js';
import { logger } from './logger.js';

// Architecture serveur :
// - "infra" expose les transports HTTP et Socket.IO
// - "app" orchestre les parties et manipule le stockage
// - "domain" contient les règles du jeu
//
// Point d'entrée du serveur Node.js.
// Il instancie une application HTTP et y attache un serveur Socket.IO
// pour permettre la communication temps réel avec les clients Flutter.
const PORT = Number(process.env.PORT ?? 3000);

const { httpServer } = createHttpApp();
// Les événements de jeu transitent par Socket.IO.
createSocketServer(httpServer);

// Gestion explicite des erreurs serveur (ex.: EADDRINUSE)
httpServer.on('error', (err: any) => {
  const code = err?.code ?? 'UNKNOWN';
  const msg = String(err?.message ?? err);
  logger.error({ event: 'server.error', code, message: msg, port: PORT });
  if (code === 'EADDRINUSE') {
    logger.error({ event: 'server.port_in_use', port: PORT }, 'Port already in use');
    process.exit(1);
  }
  // Par défaut, faire échouer le processus pour éviter un état incohérent
  process.exit(1);
});

httpServer.listen(PORT, () => {
  logger.info({ event: 'server.started', port: PORT }, 'HTTP+Socket.IO server started');
});

// Durcir le process contre les promesses non catchées pour éviter les crashs silencieux
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaughtException', error: String(err?.message ?? err) });
});
