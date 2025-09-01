import { Server } from 'socket.io';
import { Orchestrator } from '../app/orchestrator.js';
import { logger } from '../logger.js';
import { CreateGameSchema, JoinGameSchema, ResumeSchema, ReadySchema, WolvesChooseSchema, WitchDecisionSchema, DayAckSchema, VoteCastSchema } from '../app/schemas.js';
export function createSocketServer(httpServer) {
    const io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        transports: ['websocket']
    });
    const orch = new Orchestrator(io);
    function handle(socket, event, schema, fn) {
        socket.on(event, (payload, ack) => {
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
            }
            catch (e) {
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
        socket.on('lobby:listGames', (_, ack) => {
            if (typeof ack === 'function') {
                ack({ ok: true, data: { games: orch.listGames() } });
            }
        });
        handle(socket, 'lobby:create', CreateGameSchema, (data, ack) => {
            const res = orch.createGame(data.nickname, data.variant, socket);
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
        handle(socket, 'session:resume', ResumeSchema, (data, ack) => {
            orch.resume(data.gameId, data.playerId, socket);
            if (typeof ack === 'function') {
                ack({ ok: true });
            }
        });
        handle(socket, 'player:ready', ReadySchema, (_data, ack) => {
            const { gameId, playerId } = socket.data || {};
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
        handle(socket, 'wolves:chooseTarget', WolvesChooseSchema, (data, ack) => {
            const { gameId, playerId } = socket.data || {};
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
        handle(socket, 'witch:decision', WitchDecisionSchema, (data, ack) => {
            const { gameId, playerId } = socket.data || {};
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
        handle(socket, 'day:ack', DayAckSchema, (_data, ack) => {
            const { gameId, playerId } = socket.data || {};
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
            const { gameId, playerId } = socket.data || {};
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
        // Context binder after lobby actions
        // The client should set socket.data after create/join/resume acks.
        socket.on('context:set', (payload, ack) => {
            try {
                const { gameId, playerId } = payload ?? {};
                if (!gameId || !playerId)
                    throw new Error('invalid_context');
                socket.data.gameId = gameId;
                socket.data.playerId = playerId;
                socket.join(`room:${gameId}`);
                if (typeof ack === 'function') {
                    ack({ ok: true });
                }
            }
            catch (e) {
                if (typeof ack === 'function') {
                    ack({ ok: false, error: e?.message ?? 'invalid_context' });
                }
            }
        });
    });
    return { io, orch };
}
//# sourceMappingURL=socket.js.map