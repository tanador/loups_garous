import { Server, Socket } from "socket.io";
import { GameStore } from "../store.js";
import type { Game, Player } from "../../domain/types.js";
import { CONFIG, VIBRATION } from "../timers.js";
import { logger } from "../../logger.js";
import { createContext } from "./context.js";
import type { OrchestratorContext } from "./context.js";
import { createLobbyApi } from "./lobby.js";
import { createNightApi } from "./phases/night.js";
import { createDayApi } from "./phases/day.js";
import { createVoteApi } from "./phases/vote.js";
import {
  livingAckProgress,
  limit as limitHelper,
  mustGet,
  setDeadline,
} from "./utils.js";

function now() {
  return Date.now();
}

export class Orchestrator {
  private io: Server;
  private store = new GameStore();
  private ctx: OrchestratorContext;
  private lobby: ReturnType<typeof createLobbyApi>;
  private night: ReturnType<typeof createNightApi>;
  private day: ReturnType<typeof createDayApi>;
  private vote: ReturnType<typeof createVoteApi>;
  private rateCounters = new Map<string, { n: number; resetAt: number }>();
  private hunterAwaiting = new Map<
    string,
    {
      resolve: (target?: string) => void;
      alive: string[];
      timer: NodeJS.Timeout;
    }
  >();
  private pendingHunters = new Map<string, string[]>();
  private morningRecaps = new Map<
    string,
    { deaths: { playerId: string; role: string }[]; hunterKills: string[] }
  >();
  private pendingDayElimAck = new Map<string, string>();
  private pendingDayAcks = new Set<string>();

  constructor(io: Server) {
    this.io = io;
    this.ctx = createContext({
      io: this.io,
      store: this.store,
      log: (gameId, phase, playerId, event, extra) =>
        this.log(gameId, phase, playerId, event, extra),
    });

    this.ctx.helpers = {
      sendSnapshot: (game, playerId) => this.sendSnapshot(game, playerId),
      broadcastState: (game) => this.broadcastState(game),
      emitLobbyUpdate: () => this.emitLobbyUpdate(),
      globalSleep: (game, next) => this.globalSleep(game, next),
      beginNightThief: (game) => this.beginNightThief(game),
      beginNightCupid: (game) => this.beginNightCupid(game),
      beginNightSeer: (game) => this.beginNightSeer(game),
      beginMorning: (game) => this.beginMorning(game),
    };

    this.night = createNightApi(this.ctx);
    this.vote = createVoteApi(this.ctx, {
      pendingDayAcks: this.pendingDayAcks,
      pendingDayElimAck: this.pendingDayElimAck,
      emitGameEnded: (game, win) => this.emitGameEnded(game, win),
      playerLite: (game, pid) => this.playerLite(game, pid),
      askHunterTarget: (game, hunterId, alive) =>
        this.askHunterTarget(game, hunterId, alive),
    });
    this.day = createDayApi(this.ctx, {
      pendingHunters: this.pendingHunters,
      morningRecaps: this.morningRecaps,
      askHunterTarget: (game, hunterId, alive) =>
        this.askHunterTarget(game, hunterId, alive),
      hunterOptions: (game, hunterId, alive) =>
        this.hunterOptions(game, hunterId, alive),
      pendingDayAcks: this.pendingDayAcks,
      livingAckProgress: (game, ackSet) => livingAckProgress(game, ackSet),
      emitGameEnded: (game, win) => this.emitGameEnded(game, win),
      beginVote: (game) => this.beginVote(game),
      beginCheckEnd: (game) => this.beginCheckEnd(game),
    });
    this.lobby = createLobbyApi(this.ctx);

    setInterval(() => this.store.cleanupFinished(), 30_000);
  }

  listGames() {
    return this.lobby.listGames();
  }

  createGame(nickname: string, maxPlayers: number, socket: Socket) {
    return this.lobby.createGame(nickname, maxPlayers, socket);
  }

  joinGame(gameId: string, nickname: string, socket: Socket) {
    return this.lobby.joinGame(gameId, nickname, socket);
  }

  cancelGame(gameId: string, playerId: string) {
    this.lobby.cancelGame(gameId, playerId);
  }

  leaveGame(gameId: string, playerId: string) {
    this.lobby.leaveGame(gameId, playerId);
  }

  resume(gameId: string, playerId: string, socket: Socket) {
    this.lobby.resume(gameId, playerId, socket);
  }

  playerReady(gameId: string, playerId: string) {
    this.lobby.playerReady(gameId, playerId);
  }

  playerUnready(gameId: string, playerId: string) {
    this.lobby.playerUnready(gameId, playerId);
  }

  public bindPlayerToRooms(game: Game, player: Player, socket: Socket) {
    this.lobby.bindPlayerToRooms(game, player, socket);
  }

  private emitLobbyUpdate() {
    this.io.emit("lobby:updated", { games: this.listGames() });
  }

  private globalSleep(game: Game, next: () => void) {
    this.night.globalSleep(game, next);
  }

  private beginNightThief(game: Game) {
    this.night.beginNightThief(game);
  }

  thiefChoose(gameId: string, playerId: string, action: "keep" | "swap", index?: number) {
    this.night.thiefChoose(gameId, playerId, action, index);
  }

  private beginNightCupid(game: Game) {
    this.night.beginNightCupid(game);
  }

  cupidChoose(gameId: string, playerId: string, targetA: string, targetB: string) {
    this.night.cupidChoose(gameId, playerId, targetA, targetB);
  }

  loversAck(gameId: string, playerId: string) {
    this.night.loversAck(gameId, playerId);
  }

  private beginNightSeer(game: Game) {
    this.night.beginNightSeer(game);
  }

  private beginNightWolves(game: Game) {
    this.night.beginNightWolves(game);
  }

  private beginNightWitch(game: Game) {
    this.night.beginNightWitch(game);
  }

  seerPeek(gameId: string, playerId: string, targetId: string) {
    this.night.seerPeek(gameId, playerId, targetId);
  }

  seerAck(gameId: string, playerId: string) {
    this.night.seerAck(gameId, playerId);
  }

  wolvesChoose(gameId: string, playerId: string, targetId: string) {
    this.night.wolvesChoose(gameId, playerId, targetId);
  }

  witchDecision(
    gameId: string,
    playerId: string,
    save: boolean,
    poisonTargetId?: string,
  ) {
    this.night.witchDecision(gameId, playerId, save, poisonTargetId);
  }

  private async beginMorning(game: Game) {
    await this.day.beginMorning(game);
  }

  dayAck(gameId: string, playerId: string) {
    this.day.dayAck(gameId, playerId);
  }

  public async handleMorningEnd(game: Game) {
    await this.day.handleMorningEnd(game);
  }

  private beginVote(game: Game) {
    this.vote.beginVote(game);
  }

  voteCast(gameId: string, playerId: string, targetId: string) {
    this.vote.voteCast(gameId, playerId, targetId);
  }

  voteCancel(gameId: string, playerId: string) {
    this.vote.voteCancel(gameId, playerId);
  }

  voteAck(gameId: string, playerId: string) {
    this.vote.voteAck(gameId, playerId);
  }

  private beginCheckEnd(game: Game) {
    this.vote.beginCheckEnd(game);
  }

  hunterShoot(gameId: string, playerId: string, targetId: string) {
    const game = mustGet(this.ctx, gameId);
    const key = `${gameId}:${playerId}`;
    const pending = this.hunterAwaiting.get(key);
    if (!pending) throw new Error("no_pending_shot");
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && lover === targetId) throw new Error("cannot_target_lover");
    if (!pending.alive.includes(targetId)) throw new Error("invalid_target");
    clearTimeout(pending.timer);
    this.hunterAwaiting.delete(key);
    this.setHunterPending(game, false);
    this.broadcastState(game);
    pending.resolve(targetId);
    this.log(gameId, "HUNTER", playerId, "hunter.shoot", { targetId });
  }

  private playerSocket(game: Game, playerId: string) {
    const p = game.players.find((x) => x.id === playerId);
    if (!p) throw new Error("player_not_found");
    return p.socketId;
  }

  private playerLite(game: Game, pid: string) {
    const p = game.players.find((x) => x.id === pid)!;
    return { id: p.id };
  }

  private hunterOptions(game: Game, hunterId: string, pool: string[]) {
    const lover = game.players.find((p) => p.id === hunterId)?.loverId;
    return pool.filter((pid) => pid !== hunterId && pid !== lover);
  }

  private askHunterTarget(
    game: Game,
    hunterId: string,
    alive: string[],
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const socketId = this.playerSocket(game, hunterId);
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        resolve(undefined);
        return;
      }
      const options = this.hunterOptions(game, hunterId, alive);

      const key = `${game.id}:${hunterId}`;
      const rawSeconds = Number(CONFIG.DELAI_CHASSEUR_SECONDES);
      const waitMs = (
        Number.isFinite(rawSeconds) && rawSeconds >= 0
          ? Math.max(0, Math.round(rawSeconds * 1000))
          : 60_000
      );
      const timer = setTimeout(() => {
        const stored = this.hunterAwaiting.get(key);
        this.hunterAwaiting.delete(key);
        const pool = stored?.alive ?? options;
        if (!pool.length) {
          this.setHunterPending(game, false);
          this.broadcastState(game);
          resolve(undefined);
          this.log(game.id, game.state, hunterId, "hunter.timeout_no_options");
          return;
        }
        const index = Math.floor(Math.random() * pool.length);
        const autoTarget = pool[index];
        this.setHunterPending(game, false);
        this.broadcastState(game);
        resolve(autoTarget);
        this.log(game.id, game.state, hunterId, "hunter.timeout_autoshoot", {
          targetId: autoTarget,
          options: pool.length,
          waitMs,
        });
      }, waitMs);
      this.hunterAwaiting.set(key, { resolve, alive: options, timer });
      this.setHunterPending(game, options.length > 0);
      setDeadline(this.ctx, game, waitMs);
      this.broadcastState(game);
      socket.emit("hunter:wake", {
        alive: options.map((pid) => this.playerLite(game, pid)),
      });
      this.log(game.id, game.state, hunterId, "hunter.wake", {
        options: options.length,
      });
    });
  }


  private setHunterPending(game: Game, active: boolean) {
    const previous = game.hunterPending === true;
    game.hunterPending = active;
    if (previous === active) return;
    this.io.to(`room:${game.id}`).emit("hunter:pending", { active });
  }

  private emitGameEnded(game: Game, win: string) {
    const roles = game.players.map((p) => ({
      playerId: p.id,
      role: game.roles[p.id],
    }));
    const loversSet = new Set<string>();
    for (const p of game.players) {
      if (p.loverId) {
        loversSet.add(p.id);
        loversSet.add(p.loverId);
      }
    }
    const lovers = Array.from(loversSet);
    const payload = { winner: win, roles, lovers };
    const room = `room:${game.id}`;
    this.io.to(room).emit("game:ended", payload);
    for (const player of game.players) {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (!socket) continue;
      const socketRooms = (socket as any).rooms as Set<string> | undefined;
      if (!socketRooms || !socketRooms.has(room)) {
        socket.emit("game:ended", payload);
      }
    }
    this.log(game.id, "END", undefined, "game.end", { winner: win });
  }

  private broadcastState(game: Game) {
    this.io.to(`room:${game.id}`).emit("game:stateChanged", {
      gameId: game.id,
      state: game.state,
      serverTime: Date.now(),
      deadline: game.deadlines?.phaseEndsAt ?? null,
      hunterPending: game.hunterPending === true,
      closingEyes: (game as any).closingEyes === true,
      config: { vibrations: VIBRATION },
    });
  }

  sendSnapshot(game: Game, toPlayerId: string) {
    const you = game.players.find((p) => p.id === toPlayerId)!;
    const publicAlive = Array.from(game.alive.values());
    const sanitized = {
      id: game.id,
      state: game.state,
      round: game.round,
      players: game.players.map((p) => ({
        id: p.id,
        connected: p.connected,
        alive: game.alive.has(p.id),
        ready: !!p.isReady,
      })),
      maxPlayers: game.maxPlayers,
      you: { id: you.id, role: game.roles[you.id] },
      night: {
        attacked:
          game.state === "NIGHT_WITCH" && game.roles[you.id] === "WITCH"
            ? game.night.attacked
            : undefined,
        saved: undefined,
        poisoned: undefined,
      },
      alive: publicAlive,
      deadline: game.deadlines?.phaseEndsAt ?? null,
      hunterPending: game.hunterPending === true,
      closingEyes: (game as any).closingEyes === true,
      config: { vibrations: VIBRATION },
    };
    this.io.to(you.socketId).emit("game:snapshot", sanitized);
  }

  markDisconnected(socket: Socket) {
    for (const g of this.store.all()) {
      const p = g.players.find((x) => x.socketId === socket.id);
      if (!p) continue;
      p.connected = false;
      p.lastSeen = now();
      this.log(g.id, g.state, p.id, "player.disconnected");
      if (g.state === "RESOLVE" && this.pendingDayElimAck.get(g.id) === p.id) {
        this.pendingDayElimAck.delete(g.id);
        this.beginCheckEnd(g);
      }
      if (g.state === "RESOLVE" && this.pendingDayAcks.has(g.id)) {
        if (!g.dayAcks) g.dayAcks = new Set<string>();
        if (g.alive.has(p.id)) {
          g.dayAcks.add(p.id);
          const { acked, needed } = livingAckProgress(g, g.dayAcks);
          if (needed === 0 || acked >= needed) {
            this.pendingDayAcks.delete(g.id);
            this.beginCheckEnd(g);
          }
        }
      }
    }
  }

  limit(socket: Socket, key: string, max = 10, windowMs = 5000): boolean {
    return limitHelper(this.ctx, this.rateCounters, socket, key, max, windowMs);
  }

  private log(
    gameId: string | undefined,
    phase: string,
    playerId: string | undefined,
    event: string,
    extra?: Record<string, unknown>,
  ) {
    logger.info({ gameId, phase, playerId, event, ...extra });
  }
}

