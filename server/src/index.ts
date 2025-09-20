/**
 * Server entry point for the Loup Garou (Werewolf) game backend.
 *
 * The project exposes a realtime API used by the Flutter client so that a group
 * of friends can play the social deduction party game better known as
 * "Loup Garou" (or "Werewolves of Millers Hollow"). The server is made of three
 * layers:
 *   - infra: transports (HTTP + Socket.IO) and schema validation
 *   - app: orchestration of games, timers, sockets, persistence
 *   - domain: immutable rules of the board game (roles, votes, night/day cycle)
 *
 * This file wires the infrastructure together:
 *   1. start an HTTP server used for health checks and static routes
 *   2. attach a Socket.IO server that delivers all realtime gameplay events
 *   3. log unexpected process errors so beginners can troubleshoot crashes
 */
import { createHttpApp } from './infra/http.js';
import { createSocketServer } from './infra/socket.js';
import { logger } from './logger.js';

// Default development port. Allow overrides via PORT for production deployments.
const PORT = Number(process.env.PORT ?? 3000);

const { httpServer } = createHttpApp();

// Gameplay is entirely driven by Socket.IO events (join lobby, vote, night actions).
createSocketServer(httpServer);

// Fail loudly on server errors so we never keep a corrupted state in memory.
httpServer.on('error', (err: any) => {
  const code = err?.code ?? 'UNKNOWN';
  const msg = String(err?.message ?? err);
  logger.error({ event: 'server.error', code, message: msg, port: PORT });
  if (code === 'EADDRINUSE') {
    logger.error({ event: 'server.port_in_use', port: PORT }, 'Port already in use');
    process.exit(1);
  }
  process.exit(1);
});

httpServer.listen(PORT, () => {
  logger.info({ event: 'server.started', port: PORT }, 'HTTP+Socket.IO server started');
});

// Guard against silent crashes caused by unhandled promises or sync exceptions.
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaughtException', error: String(err?.message ?? err) });
});
