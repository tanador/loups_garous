/**
 * Shared application logger.
 *
 * We use pino because it produces structured JSON logs that are easy to parse
 * in development and production. Beginners can tail the console while running
 * `npm run dev` to understand how the server reacts to each action.
 */
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
  base: {
    svc: 'loup-garou-server',
  },
});
