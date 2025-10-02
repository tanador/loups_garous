/**
 * Socket.IO transport wiring for the Werewolf backend.
 *
 * The Flutter client talks to the server exclusively through realtime events.
 * This module creates the Socket.IO server, registers every gameplay command
 * (lobby, night actions, votes) and forwards them to the Orchestrator after
 * validating payloads with Zod schemas.
 *
 * If you are new to Socket.IO: each `socket.on("event")` handler below maps to
 * a message emitted by the client. We always respond with an ACK shaped as
 * `{ ok: boolean, data?, error? }` to keep the protocol predictable for beginners.
 */

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Orchestrator } from '../app/orchestrator.js';
import { logger } from '../logger.js';
import { CreateGameSchema, JoinGameSchema, CancelGameSchema, LeaveGameSchema, ResumeSchema, ReadySchema, WolvesChooseSchema, SeerPeekSchema, SeerAckSchema, WitchDecisionSchema, HunterShootSchema, DayAckSchema, VoteCastSchema, VoteCancelSchema, CupidChooseSchema, LoversAckSchema, VoteAckSchema, ThiefChooseSchema } from '../app/schemas.js';

/**
 * Create a Socket.IO server and register all gameplay handlers.
 *
 * The function receives the HTTP server created in src/index.ts and attaches
 * Socket.IO so both transports share the same port. Each handler reuses the
 * `handle` helper to validate payloads, enforce basic rate limiting and send
 * `{ ok: false, error }` acknowledgements when something goes wrong.
 */
export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket']
  });
  const orch = new Orchestrator(io);

  /**
   * Small wrapper around Socket.IO handlers.
   *
   * It parses the payload with the provided Zod schema, applies the
   * orchestrator's rate limit, and report errors through the standard
   * `{ ok: false, error }` acknowledgement so the client can display
   * friendly messages.
   */
  function handle<T extends { parse: (v: unknown) => any }>(
    socket: Socket, event: string, schema: T,
    fn: (payload: ReturnType<T['parse']>, ack?: (res: any) => void) => void
  ) {
    socket.on(event, (payload: any, ack?: (res: any) => void) => {
      try {
        if (!orch.limit(socket, event)) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'rate_limited' });
          }
          return;
        }
        const data = schema.parse(payload ?? {});
        Promise.resolve(fn(data, ack)).catch((e) => {
          logger.warn({ event, err: String(e?.message ?? e) }, 'handler_error');
          if (typeof ack === 'function') {
            ack({ ok: false, error: String(e?.message ?? e) });
          }
        });
      } catch (e: any) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: e?.message ?? 'invalid_payload' });
        }
      }
    });
  }

  io.on('connection', (socket) => {
    logger.info({ event: 'socket.connected', socketId: socket.id });

    socket.on('disconnect', () => {
      orch.markDisconnected(socket);
      logger.info({ event: 'socket.disconnected', socketId: socket.id });
    });

    // Lobby
    // Push the current lobby snapshot immediately so newcomers stay in sync.
    socket.emit('lobby:updated', { games: orch.listGames() });

    handle(socket, 'lobby:create', CreateGameSchema, (data, ack) => {
      const res = orch.createGame(data.nickname, data.maxPlayers, socket);
      if (typeof ack === 'function') {
        ack({ ok: true, data: res });
      }
    });

    handle(socket, 'lobby:join', JoinGameSchema, (data, ack) => {
      const res = orch.joinGame(data.gameId, data.nickname, socket);
      if (typeof ack === 'function') {
        ack({ ok: true, data: res });
      }
    });

    handle(socket, 'lobby:cancel', CancelGameSchema, (data, ack) => {
      const { gameId, playerId } = data;
      orch.cancelGame(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'lobby:leave', LeaveGameSchema, (data, ack) => {
      const { gameId, playerId } = data;
      orch.leaveGame(gameId, playerId);
      socket.leave(`room:${gameId}`);
      delete socket.data.gameId;
      delete socket.data.playerId;
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'session:resume', ResumeSchema, (data, ack) => {
      orch.resume(data.gameId, data.playerId, socket);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'player:ready', ReadySchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.playerReady(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'player:unready', ReadySchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.playerUnready(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'wolves:chooseTarget', WolvesChooseSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.wolvesChoose(gameId, playerId, data.targetId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    // Seer: the player chooses a target and asks the server to reveal the role.
    handle(socket, 'seer:peek', SeerPeekSchema, (data, ack) => {
      const ctx = (socket.data ?? {}) as { gameId?: string; playerId?: string };
      const { gameId, playerId } = ctx;
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.seerPeek(gameId, playerId, data.targetId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    // Seer: ack sent once the vision is read so the night can continue.
    handle(socket, 'seer:ack', SeerAckSchema, (_data, ack) => {
      const ctx = (socket.data ?? {}) as { gameId?: string; playerId?: string };
      const { gameId, playerId } = ctx;
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.seerAck(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'cupid:choose', CupidChooseSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.cupidChoose(gameId, playerId, data.targetA, data.targetB);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'witch:decision', WitchDecisionSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.witchDecision(gameId, playerId, data.save, data.poisonTargetId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'hunter:shoot', HunterShootSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.hunterShoot(gameId, playerId, data.targetId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'day:ack', DayAckSchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.dayAck(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'vote:cast', VoteCastSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.voteCast(gameId, playerId, data.targetId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'vote:cancel', VoteCancelSchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.voteCancel(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    // Day vote ack: the eliminated player confirms they saw the result.
    // No fallback: we wait for the ack (or a disconnect) before moving on.
    handle(socket, 'vote:ack', VoteAckSchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.voteAck(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    // Thief (Voleur)
    // Private phase: user can keep or swap with center[0|1].
    // Server validates: if both center cards are WOLF, 'keep' is rejected.
    handle(socket, 'thief:choose', ThiefChooseSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.thiefChoose(gameId, playerId, data.action, data.index);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    handle(socket, 'lovers:ack', LoversAckSchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'missing_context' });
        }
        return;
      }
      orch.loversAck(gameId, playerId);
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    });

    // Context binder after lobby actions
    // The client should set socket.data after create/join/resume acks.
    socket.on('context:set', (payload: any, ack?: (res: any) => void) => {
      try {
        const { gameId, playerId } = payload ?? {};
        if (!gameId || !playerId) throw new Error('invalid_context');
        socket.data.gameId = gameId;
        socket.data.playerId = playerId;
        socket.join(`room:${gameId}`);
        try {
          orch.setSocketContext(gameId, playerId, socket);
        } catch (err) {
          logger.warn({ event: 'context.set.failed', gameId, playerId, reason: String((err as Error)?.message ?? err) });
        }
        if (typeof ack === 'function') {
          ack({ ok: true });
        }
      } catch (e: any) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: e?.message ?? 'invalid_context' });
        }
      }
    });
  });

  return { io, orch };
}
