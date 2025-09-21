/**
 * Shared application logger.
 *
 * We use pino because it produces structured JSON logs that are easy to parse
 * in development and production. Beginners can tail the console while running
 * `npm run dev` to understand how the server reacts to each action.
 */
import pino from 'pino';

const padToTwoDigits = (value: number): string => value.toString().padStart(2, '0');

// Format timestamps so console output matches the `dd.mm.yy-hh:mm:ss` style
// requested by operators.
const readableTimestamp = (): string => {
  const date = new Date();
  const day = padToTwoDigits(date.getDate());
  const month = padToTwoDigits(date.getMonth() + 1);
  const year = date.getFullYear().toString().slice(-2);
  const hours = padToTwoDigits(date.getHours());
  const minutes = padToTwoDigits(date.getMinutes());
  const seconds = padToTwoDigits(date.getSeconds());

  return `,"time":"${day}.${month}.${year}-${hours}:${minutes}:${seconds}"`;
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
  timestamp: readableTimestamp,
  base: {
    svc: 'loup-garou-server',
  },
});
