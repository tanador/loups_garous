import pino from 'pino';
// Logger global utilisé dans tout le serveur.
// Pino offre des logs structurés et très performants.
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
    base: {
        svc: 'loup-garou-server'
    }
});
//# sourceMappingURL=logger.js.map