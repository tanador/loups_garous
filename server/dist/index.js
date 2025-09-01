import { createHttpApp } from './infra/http.js';
import { createSocketServer } from './infra/socket.js';
import { logger } from './logger.js';
const PORT = Number(process.env.PORT ?? 3000);
const { app, httpServer } = createHttpApp();
createSocketServer(httpServer);
httpServer.listen(PORT, () => {
    logger.info({ event: 'server.started', port: PORT }, 'HTTP+Socket.IO server started');
});
//# sourceMappingURL=index.js.map