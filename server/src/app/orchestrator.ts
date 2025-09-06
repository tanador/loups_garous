import { Server, Socket } from 'socket.io';
import { GameStore } from './store.js';
import { createGame, addPlayer, removePlayer } from '../domain/game.js';
import { Game, Player } from '../domain/types.js';
import { assignRoles, wolvesOf, targetsForWolves, targetsForWitch, computeNightDeaths, applyDeaths, computeVoteResult, winner, alivePlayers, witchId, isConsensus } from '../domain/rules.js';
import { setState, canTransition } from '../domain/fsm.js';
import { DURATION } from './timers.js';
import { logger } from '../logger.js';

type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string; code?: string }) => void;

function now() { return Date.now(); }

export class Orchestrator {
  private io: Server;
  private store = new GameStore();
  private timers = new Map<string, NodeJS.Timeout>();
  private rateCounters = new Map<string, { n: number; resetAt: number }>(); // per-socket simple limiter
  private hunterAwaiting = new Map<string, { resolve: (target?: string) => void; alive: string[]; timer: NodeJS.Timeout }>();

  constructor(io: Server) {
    this.io = io;
    setInterval(() => this.store.cleanupFinished(), 30_000);
  }

  // -------------------- Lobby API --------------------
  listGames() {
    return this.store.listLobby();
  }

  createGame(nickname: string, maxPlayers: number, socket: Socket) {
    const game = createGame(maxPlayers);
    const player: Player = addPlayer(game, { id: nickname, socketId: socket.id });
    this.store.put(game);
    this.bindPlayerToRooms(game, player, socket);
    this.emitLobbyUpdate();
    this.log(game.id, 'LOBBY', player.id, 'lobby.create', { maxPlayers });
    this.tryAutostart(game);
    return { gameId: game.id, playerId: player.id, maxPlayers: game.maxPlayers };
  }

  joinGame(gameId: string, nickname: string, socket: Socket) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('game_not_found');
    if (game.state !== 'LOBBY') throw new Error('game_already_started');
    if (game.players.length >= game.maxPlayers) throw new Error('game_full');

    const player: Player = addPlayer(game, { id: nickname, socketId: socket.id });
    this.bindPlayerToRooms(game, player, socket);
    this.store.put(game);
    this.emitLobbyUpdate();
    this.log(game.id, 'LOBBY', player.id, 'lobby.join');
    this.tryAutostart(game);
    return { gameId: game.id, playerId: player.id, maxPlayers: game.maxPlayers };
  }

  cancelGame(gameId: string, playerId: string) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('game_not_found');
    if (game.players[0]?.id !== playerId) throw new Error('not_owner');
    if (game.state !== 'LOBBY') throw new Error('game_already_started');
    this.store.del(gameId);
    this.io.to(`room:${gameId}`).emit('game:cancelled', {});
    this.emitLobbyUpdate();
    this.log(gameId, 'LOBBY', playerId, 'lobby.cancel');
  }

  leaveGame(gameId: string, playerId: string) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('game_not_found');
    if (game.state !== 'LOBBY') throw new Error('game_already_started');
    if (game.players[0]?.id === playerId) {
      this.cancelGame(gameId, playerId);
      return;
    }
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('player_not_found');
    removePlayer(game, playerId);
    this.store.put(game);
    this.emitLobbyUpdate();
    for (const p of game.players) {
      this.sendSnapshot(game, p.id);
    }
    this.log(gameId, 'LOBBY', playerId, 'lobby.leave');
  }

  resume(gameId: string, playerId: string, socket: Socket) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('game_not_found');
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('player_not_found');

    player.socketId = socket.id;
    player.connected = true;
    player.lastSeen = now();
    this.bindPlayerToRooms(game, player, socket);
    this.sendSnapshot(game, playerId);
    this.log(game.id, game.state, playerId, 'session.resume');
  }

  // -------------------- Bindings and Rooms --------------------
  private bindPlayerToRooms(game: Game, player: Player, socket: Socket) {
    socket.join(`room:${game.id}`);
    if (game.roles[player.id]) {
      const role = game.roles[player.id];
      if (role === 'WOLF') socket.join(`room:${game.id}:wolves`);
      if (role === 'WITCH') socket.join(`room:${game.id}:witch`);
    }
  }

  private emitLobbyUpdate() {
    this.io.emit('lobby:updated', { games: this.listGames() });
  }

  // -------------------- Autostart and Roles --------------------
  private tryAutostart(game: Game) {
    if (game.players.length === game.maxPlayers && game.state === 'LOBBY') {
      setState(game, 'ROLES');
      assignRoles(game);
      // attach role rooms
      for (const p of game.players) {
        const s = this.io.sockets.sockets.get(p.socketId);
        if (s) this.bindPlayerToRooms(game, p, s);
      }
      // notify roles privately
      for (const p of game.players) {
        this.io.to(p.socketId).emit('role:assigned', { role: game.roles[p.id] });
      }
      this.broadcastState(game);
      this.log(game.id, 'ROLES', undefined, 'roles.assigned', { roles: 'hidden' });
    }
  }

  playerReady(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    const p = game.players.find(x => x.id === playerId);
    if (!p) throw new Error('player_not_found');
    p.isReady = true;
    this.log(gameId, game.state, playerId, 'player.ready');
    const allReady = game.players.every(x => x.isReady);
    if (allReady && game.state === 'ROLES') {
      this.beginNightWolves(game);
    }
  }

  playerUnready(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    const p = game.players.find(x => x.id === playerId);
    if (!p) throw new Error('player_not_found');
    p.isReady = false;
    this.log(gameId, game.state, playerId, 'player.unready');
  }

  // -------------------- Phases --------------------
  private beginNightWolves(game: Game) {
    if (!canTransition(game, game.state, 'NIGHT_WOLVES')) return;
    game.round += 1;
    game.night = {};
    game.wolvesChoices = {};
    setState(game, 'NIGHT_WOLVES');
    this.setDeadline(game, DURATION.WOLVES_MS);
    this.broadcastState(game);

    const targets = targetsForWolves(game).map(pid => this.playerLite(game, pid));
    this.io.to(`room:${game.id}:wolves`).emit('wolves:wake', { alive: targets });
    this.log(game.id, game.state, undefined, 'wolves.wake', { targets: targets.length });

    this.schedule(game.id, DURATION.WOLVES_MS, () => this.endNightWolves(game.id));
  }

  wolvesChoose(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'NIGHT_WOLVES') throw new Error('bad_state');
    if (game.roles[playerId] !== 'WOLF') throw new Error('forbidden');
    if (!game.alive.has(targetId)) throw new Error('invalid_target');
    if (game.roles[targetId] === 'WOLF') throw new Error('invalid_target');

    game.wolvesChoices[playerId] = targetId;
    const { consensus, target } = isConsensus(game);
    const wolves = wolvesOf(game);
    const confirmations = wolves.filter(w => game.wolvesChoices[w] === target).length;
    const confirmationsRemaining = Math.max(wolves.length - confirmations, 0);

    this.io.to(`room:${game.id}:wolves`).emit('wolves:targetLocked', {
      targetId: target ?? null,
      confirmationsRemaining
    });
    this.log(game.id, game.state, playerId, 'wolves.choose', { targetId });

    if (consensus && target) {
      game.night.attacked = target;
      // fin anticipée de la phase
      this.endNightWolves(game.id);
    }
  }

  private endNightWolves(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'NIGHT_WOLVES') return; // déjà passé
    // Si pas de consensus ou pas de choix: aucune attaque
    const { consensus, target } = isConsensus(game);
    game.night.attacked = consensus ? target : undefined;

    this.beginNightWitch(game);
  }

  private beginNightWitch(game: Game) {
    if (!canTransition(game, game.state, 'NIGHT_WITCH')) return;
    setState(game, 'NIGHT_WITCH');

    const wid = witchId(game);
    // S'il n'y a pas de sorcière vivante, on saute directement à la phase suivante
    if (!wid) {
      this.broadcastState(game);
      return this.beginMorning(game);
    }

    this.setDeadline(game, DURATION.WITCH_MS);
    this.broadcastState(game);

    const attacked = game.night.attacked;
    const s = this.io.sockets.sockets.get(this.playerSocket(game, wid));
    if (s) {
      s.emit('witch:wake', {
        attacked,
        healAvailable: !game.inventory.witch.healUsed && !!attacked,
        poisonAvailable: !game.inventory.witch.poisonUsed,
        alive: targetsForWitch(game).map(pid => this.playerLite(game, pid))
      });
    }
    this.log(game.id, game.state, wid, 'witch.wake', { attacked: attacked ?? null });

    this.schedule(game.id, DURATION.WITCH_MS, () => this.endNightWitch(game.id));
  }

  witchDecision(gameId: string, playerId: string, save: boolean, poisonTargetId?: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'NIGHT_WITCH') throw new Error('bad_state');
    if (game.roles[playerId] !== 'WITCH') throw new Error('forbidden');

    // save
    if (save) {
      if (!game.night.attacked) throw new Error('nothing_to_save');
      if (game.inventory.witch.healUsed) throw new Error('heal_already_used');
      game.night.saved = game.night.attacked; // auto-soin autorisé si cible = witch
      game.inventory.witch.healUsed = true;
    }
    // poison
    if (poisonTargetId) {
      if (game.inventory.witch.poisonUsed) throw new Error('poison_already_used');
      if (poisonTargetId === playerId) throw new Error('cannot_poison_self');
      if (!game.alive.has(poisonTargetId)) throw new Error('invalid_poison_target');
      game.night.poisoned = poisonTargetId;
      game.inventory.witch.poisonUsed = true;
    }

    this.log(game.id, game.state, playerId, 'witch.decision', {
      saved: !!game.night.saved, poisoned: !!game.night.poisoned
    });

    this.endNightWitch(game.id);
  }

  hunterShoot(gameId: string, playerId: string, targetId: string) {
    const key = `${gameId}:${playerId}`;
    const pending = this.hunterAwaiting.get(key);
    if (!pending) throw new Error('no_pending_shot');
    if (!pending.alive.includes(targetId)) throw new Error('invalid_target');
    clearTimeout(pending.timer);
    this.hunterAwaiting.delete(key);
    pending.resolve(targetId);
    this.log(gameId, 'HUNTER', playerId, 'hunter.shoot', { targetId });
  }

  private async endNightWitch(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'NIGHT_WITCH') return;
    await this.beginMorning(game);
  }

  private async beginMorning(game: Game) {
    if (!canTransition(game, game.state, 'MORNING')) return;

    const initial = await computeNightDeaths(game);
    const { deaths } = await applyDeaths(game, initial);

    // informer immédiatement les clients des morts de la nuit
    for (const p of game.players) {
      this.sendSnapshot(game, p.id);
    }
    const recap = {
      deaths: deaths.map(pid => ({ playerId: pid, role: game.roles[pid] })),
      hunterKills: [] as { hunterId: string; targetId: string }[],
    };
    this.io.to(`room:${game.id}`).emit('day:recap', recap);
    this.log(game.id, game.state, undefined, 'day.recap', {
      deaths: deaths.length,
      hunterKills: 0,
    });

    setState(game, 'MORNING');
    this.broadcastState(game);

    // les chasseurs morts agiront après les acknowledgements
    game.huntersToShoot = deaths.filter(pid => game.roles[pid] === 'HUNTER');

    // si aucun chasseur n'est concerné, vérifier immédiatement la fin de partie
    if (game.huntersToShoot.length === 0) {
      const win = winner(game);
      if (win) {
        setState(game, 'END');
        this.broadcastState(game);
        const roles = game.players.map(p => ({ playerId: p.id, role: game.roles[p.id] }));
        this.io.to(`room:${game.id}`).emit('game:ended', { winner: win, roles });
        this.log(game.id, 'END', undefined, 'game.end', { winner: win });
        return;
      }
    }

    game.morningAcks.clear();
    this.setDeadline(game, DURATION.MORNING_MS);
    this.broadcastState(game);

    // attente des acks OU timeout
    this.schedule(game.id, DURATION.MORNING_MS, () => this.handleMorningEnd(game));
  }

  dayAck(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'MORNING') throw new Error('bad_state');
    game.morningAcks.add(playerId);
    this.log(game.id, game.state, playerId, 'day.ack');
    const needed = game.alive.size + (game.huntersToShoot?.length ?? 0);
    if (game.morningAcks.size >= needed) {
      this.handleMorningEnd(game);
    }
  }

  private async handleMorningEnd(game: Game) {
    if (game.state !== 'MORNING') return;
    // si des chasseurs doivent encore tirer, on les réveille maintenant
    const pending = [...(game.huntersToShoot ?? [])];
    game.huntersToShoot = [];
    for (const hid of pending) {
      const target = await this.askHunterTarget(game, hid, alivePlayers(game));
      if (target && game.alive.has(target)) {
        const res = await applyDeaths(game, [target], (h, alive) => this.askHunterTarget(game, h, alive));
        // mise à jour des clients sur les nouveaux morts
        for (const p of game.players) {
          this.sendSnapshot(game, p.id);
        }
        for (const s of res.hunterShots) {
          this.io.to(`room:${game.id}`).emit('day:hunterKill', { targetId: s.targetId });
          this.log(game.id, 'HUNTER', s.hunterId, 'hunter.kill', { targetId: s.targetId });
        }
      }
    }

    const win = winner(game);
    if (win) {
      setState(game, 'END');
      this.broadcastState(game);
      const roles = game.players.map(p => ({ playerId: p.id, role: game.roles[p.id] }));
      this.io.to(`room:${game.id}`).emit('game:ended', { winner: win, roles });
      this.log(game.id, 'END', undefined, 'game.end', { winner: win });
      return;
    }

    this.beginVote(game);
  }

  private beginVote(game: Game) {
    if (!canTransition(game, game.state, 'VOTE')) return;
    setState(game, 'VOTE');
    game.votes = {};
    game.deadlines = {};
    this.broadcastState(game);

    const alive = alivePlayers(game).map(pid => this.playerLite(game, pid));
    this.io.to(`room:${game.id}`).emit('vote:options', { alive });
    this.log(game.id, game.state, undefined, 'vote.begin', { alive: alive.length });
  }

  voteCast(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'VOTE') throw new Error('bad_state');
    if (!game.alive.has(playerId)) throw new Error('dead_cannot_vote');
    if (!game.alive.has(targetId)) throw new Error('invalid_target');
    game.votes[playerId] = targetId;
    this.log(game.id, game.state, playerId, 'vote.cast', { targetId });

    // si tous les vivants ont voté, on clôture
    const allVoted = alivePlayers(game).every(pid => pid in game.votes);
    if (allVoted) this.endVote(game.id);
  }

  private async endVote(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'VOTE') return;
    const { eliminated, tally } = computeVoteResult(game);
    const tie = !eliminated && Object.keys(tally).length > 0;
    if (tie) {
      this.io.to(`room:${game.id}`).emit('vote:results', {
        eliminatedId: null,
        role: null,
        tally
      });
      this.log(game.id, 'VOTE', undefined, 'vote.results', { eliminated: null, tie: true });
      setTimeout(() => {
        game.votes = {};
        game.deadlines = {};
        const alive = alivePlayers(game).map(pid => this.playerLite(game, pid));
        this.io.to(`room:${game.id}`).emit('vote:options', { alive });
        this.log(game.id, 'VOTE', undefined, 'vote.revote', { alive: alive.length });
      }, 1_000);
      return;
    }

    setState(game, 'RESOLVE');
    if (eliminated) {
      await applyDeaths(game, [eliminated], (hid, alive) => this.askHunterTarget(game, hid, alive));
    }

    this.io.to(`room:${game.id}`).emit('vote:results', {
      eliminatedId: eliminated ?? null,
      role: eliminated ? game.roles[eliminated] : null,
      tally
    });
    this.log(game.id, 'RESOLVE', undefined, 'vote.results', { eliminated: eliminated ?? null });

    this.beginCheckEnd(game);
  }

  private beginCheckEnd(game: Game) {
    setState(game, 'CHECK_END');
    const win = winner(game);
    if (win) {
      setState(game, 'END');
      this.broadcastState(game);
      const roles = game.players.map(p => ({
        playerId: p.id,
        role: game.roles[p.id]
      }));
      this.io.to(`room:${game.id}`).emit('game:ended', { winner: win, roles });
      this.log(game.id, 'END', undefined, 'game.end', { winner: win });
    } else {
      this.beginNightWolves(game);
    }
  }

  // -------------------- Helpers --------------------
  private mustGet(gameId: string): Game {
    const g = this.store.get(gameId);
    if (!g) throw new Error('game_not_found');
    return g;
  }

  private setDeadline(game: Game, ms: number) {
    game.deadlines = { phaseEndsAt: now() + ms };
  }

  private schedule(gameId: string, ms: number, cb: () => void) {
    const old = this.timers.get(gameId);
    if (old) clearTimeout(old);
    const t = setTimeout(cb, ms);
    this.timers.set(gameId, t);
  }

  private playerSocket(game: Game, playerId: string) {
    const p = game.players.find(x => x.id === playerId);
    if (!p) throw new Error('player_not_found');
    return p.socketId;
  }

  private playerLite(game: Game, pid: string) {
    const p = game.players.find(x => x.id === pid)!;
    return { id: p.id };
  }

  private askHunterTarget(game: Game, hunterId: string, alive: string[]): Promise<string | undefined> {
    return new Promise(resolve => {
      const socketId = this.playerSocket(game, hunterId);
      const s = this.io.sockets.sockets.get(socketId);
      if (!s) {
        resolve(undefined);
        return;
      }
      const key = `${game.id}:${hunterId}`;
      const timer = setTimeout(() => {
        this.hunterAwaiting.delete(key);
        resolve(undefined);
      }, DURATION.HUNTER_MS);
      this.hunterAwaiting.set(key, { resolve, alive, timer });
      this.setDeadline(game, DURATION.HUNTER_MS);
      this.broadcastState(game);
      s.emit('hunter:wake', { alive: alive.map(pid => this.playerLite(game, pid)) });
      this.log(game.id, game.state, hunterId, 'hunter.wake', { options: alive.length });
    });
  }

  private broadcastState(game: Game) {
    this.io.to(`room:${game.id}`).emit('game:stateChanged', {
      gameId: game.id,
      state: game.state,
      serverTime: Date.now(),
      deadline: game.deadlines?.phaseEndsAt ?? null
    });
  }

  sendSnapshot(game: Game, toPlayerId: string) {
    const you = game.players.find(p => p.id === toPlayerId)!;
    const publicAlive = Array.from(game.alive.values());
    const sanitized = {
      id: game.id,
      state: game.state,
      round: game.round,
      players: game.players.map(p => ({
        id: p.id, connected: p.connected, alive: game.alive.has(p.id)
      })),
      maxPlayers: game.maxPlayers,
      you: { id: you.id, role: game.roles[you.id] },
      night: {
        attacked: (game.state === 'NIGHT_WITCH' && game.roles[you.id] === 'WITCH') ? game.night.attacked : undefined,
        saved: undefined,
        poisoned: undefined
      },
      alive: publicAlive,
      deadline: game.deadlines?.phaseEndsAt ?? null
    };
    this.io.to(you.socketId).emit('game:snapshot', sanitized);
  }

  markDisconnected(socket: Socket) {
    for (const g of this.store.all()) {
      const p = g.players.find(x => x.socketId === socket.id);
      if (p) {
        p.connected = false;
        p.lastSeen = now();
        this.log(g.id, g.state, p.id, 'player.disconnected');
      }
    }
  }

  // -------------------- Rate limit --------------------
  limit(socket: Socket, key: string, max = 10, windowMs = 5000): boolean {
    const k = `${socket.id}:${key}`;
    const cur = this.rateCounters.get(k);
    const nowMs = now();
    if (!cur || cur.resetAt < nowMs) {
      this.rateCounters.set(k, { n: 1, resetAt: nowMs + windowMs });
      return true;
    }
    if (cur.n >= max) return false;
    cur.n += 1;
    return true;
  }

  // -------------------- Logging --------------------
  private log(gameId: string | undefined, phase: string, playerId: string | undefined, event: string, extra?: Record<string, unknown>) {
    logger.info({ gameId, phase, playerId, event, ...extra });
  }
}
