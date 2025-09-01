import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Orchestrator } from '../app/orchestrator.js';
import { logger } from '../logger.js';
import { CreateGameSchema, JoinGameSchema, ResumeSchema, ReadySchema, WolvesChooseSchema, WitchDecisionSchema, DayAckSchema, VoteCastSchema } from '../app/schemas.js';

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket']
  });
  const orch = new Orchestrator(io);

  function handle<T extends { parse: (v: unknown) => any }>(
    socket: Socket, event: string, schema: T,
    fn: (payload: ReturnType<T['parse']>, ack?: (res: any) => void) => void
  ) {
    socket.on(event, (payload: any, ack?: (res: any) => void) => {
      try {
        if (!orch.limit(socket, event)) {
          ack?.({ ok: false, error: 'rate_limited' });
          return;
        }
        const data = schema.parse(payload ?? {});
        Promise.resolve(fn(data, ack)).catch((e) => {
          logger.warn({ event, err: String(e?.message ?? e) }, 'handler_error');
          ack?.({ ok: false, error: String(e?.message ?? e) });
        });
      } catch (e: any) {
        ack?.({ ok: false, error: e?.message ?? 'invalid_payload' });
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
    socket.on('lobby:listGames', (_: unknown, ack?: (res: any) => void) => {
      if (typeof ack === 'function') {
        ack({ ok: true, data: { games: orch.listGames() } });
      }
    });

    handle(socket, 'lobby:create', CreateGameSchema, (data, ack) => {
      const res = orch.createGame(data.nickname, data.variant, socket);
      ack?.({ ok: true, data: res });
    });

    handle(socket, 'lobby:join', JoinGameSchema, (data, ack) => {
      const res = orch.joinGame(data.gameId, data.nickname, socket);
      ack?.({ ok: true, data: res });
    });

    handle(socket, 'session:resume', ResumeSchema, (data, ack) => {
      orch.resume(data.gameId, data.playerId, socket);
      ack?.({ ok: true });
    });

    handle(socket, 'player:ready', ReadySchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) { ack?.({ ok: false, error: 'missing_context' }); return; }
      orch.playerReady(gameId, playerId);
      ack?.({ ok: true });
    });

    handle(socket, 'wolves:chooseTarget', WolvesChooseSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) { ack?.({ ok: false, error: 'missing_context' }); return; }
      orch.wolvesChoose(gameId, playerId, data.targetId);
      ack?.({ ok: true });
    });

    handle(socket, 'witch:decision', WitchDecisionSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) { ack?.({ ok: false, error: 'missing_context' }); return; }
      orch.witchDecision(gameId, playerId, data.save, data.poisonTargetId);
      ack?.({ ok: true });
    });

    handle(socket, 'day:ack', DayAckSchema, (_data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) { ack?.({ ok: false, error: 'missing_context' }); return; }
      orch.dayAck(gameId, playerId);
      ack?.({ ok: true });
    });

    handle(socket, 'vote:cast', VoteCastSchema, (data, ack) => {
      const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string } || {};
      if (!gameId || !playerId) { ack?.({ ok: false, error: 'missing_context' }); return; }
      orch.voteCast(gameId, playerId, data.targetId);
      ack?.({ ok: true });
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
        ack?.({ ok: true });
      } catch (e: any) {
        ack?.({ ok: false, error: e?.message ?? 'invalid_context' });
      }
    });
  });

  return { io, orch };
}
