import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
  base: {
    svc: 'loup-garou-server'
  }
});
