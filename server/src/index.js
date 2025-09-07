import { createHttpApp } from './infra/http.js';
import { createSocketServer } from './infra/socket.js';
import { logger } from './logger.js';
// Point d'entrée du serveur Node.js.
// Il instancie une application HTTP et y attache un serveur Socket.IO
// pour permettre la communication temps réel avec les clients Flutter.
const PORT = Number(process.env.PORT ?? 3000);
const { app, httpServer } = createHttpApp();
// Les événements de jeu transitent par Socket.IO.
createSocketServer(httpServer);
httpServer.listen(PORT, () => {
    logger.info({ event: 'server.started', port: PORT }, 'HTTP+Socket.IO server started');
});
//# sourceMappingURL=index.js.map