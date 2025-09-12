// Couche "app": relie les sockets et le stockage aux règles du domaine.
// L'orchestrateur pilote le cycle de vie d'une partie et route les évènements.
import { Server, Socket } from "socket.io";
import { GameStore } from "./store.js";
import { createGame, addPlayer, removePlayer } from "../domain/game.js";
import { Game, Player } from "../domain/types.js";
import {
  assignRoles,
  targetsForWolves,
  targetsForWitch,
  computeNightDeaths,
  onPlayerDeath,
  resolveDeaths,
  computeVoteResult,
  winner,
  alivePlayers,
  witchId,
  isConsensus,
  activeWolves,
} from "../domain/rules.js";
import { setState, canTransition } from "../domain/fsm.js";
import { DURATION, CONFIG } from "./timers.js";
import { logger } from "../logger.js";

function now() {
  return Date.now();
}

export class Orchestrator {
  private io: Server;
  private store = new GameStore();
  private timers = new Map<string, NodeJS.Timeout>();
  // En attente de l'ACK de la voyante après révélation
  private pendingSeerAck = new Set<string>(); // gameId
  private rateCounters = new Map<string, { n: number; resetAt: number }>(); // per-socket simple limiter
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
  // Attente d'un accusé de réception du joueur éliminé en journée (après vote)
  private pendingDayElimAck = new Map<string, string>(); // gameId -> playerId

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
    const player: Player = addPlayer(game, {
      id: nickname,
      socketId: socket.id,
    });
    this.store.put(game);
    this.bindPlayerToRooms(game, player, socket);
    // Send an initial snapshot to the creator so the client can render lobby from server state
    this.sendSnapshot(game, player.id);
    this.emitLobbyUpdate();
    this.log(game.id, "LOBBY", player.id, "lobby.create", { maxPlayers });
    this.tryAutostart(game);
    return {
      gameId: game.id,
      playerId: player.id,
      maxPlayers: game.maxPlayers,
    };
  }

  joinGame(gameId: string, nickname: string, socket: Socket) {
    const game = this.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    if (game.players.length >= game.maxPlayers) throw new Error("game_full");

    const player: Player = addPlayer(game, {
      id: nickname,
      socketId: socket.id,
    });
    this.bindPlayerToRooms(game, player, socket);
    this.store.put(game);
    this.emitLobbyUpdate();
    // Send a snapshot to the newly joined player for immediate lobby sync
    this.sendSnapshot(game, player.id);
    this.log(game.id, "LOBBY", player.id, "lobby.join");
    this.tryAutostart(game);
    return {
      gameId: game.id,
      playerId: player.id,
      maxPlayers: game.maxPlayers,
    };
  }

  cancelGame(gameId: string, playerId: string) {
    const game = this.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.players[0]?.id !== playerId) throw new Error("not_owner");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    this.store.del(gameId);
    this.io.to(`room:${gameId}`).emit("game:cancelled", {});
    this.emitLobbyUpdate();
    this.log(gameId, "LOBBY", playerId, "lobby.cancel");
  }

  leaveGame(gameId: string, playerId: string) {
    const game = this.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    if (game.players[0]?.id === playerId) {
      this.cancelGame(gameId, playerId);
      return;
    }
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    removePlayer(game, playerId);
    this.store.put(game);
    this.emitLobbyUpdate();
    for (const p of game.players) {
      this.sendSnapshot(game, p.id);
    }
    this.log(gameId, "LOBBY", playerId, "lobby.leave");
  }

  resume(gameId: string, playerId: string, socket: Socket) {
    const game = this.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");

    player.socketId = socket.id;
    player.connected = true;
    player.lastSeen = now();
    this.bindPlayerToRooms(game, player, socket);
    this.sendSnapshot(game, playerId);
    this.log(game.id, game.state, playerId, "session.resume");
  }

  // -------------------- Bindings and Rooms --------------------
  private bindPlayerToRooms(game: Game, player: Player, socket: Socket) {
    socket.join(`room:${game.id}`);
    if (game.roles[player.id]) {
      const role = game.roles[player.id];
      if (role === "WOLF") socket.join(`room:${game.id}:wolves`);
      if (role === "WITCH") socket.join(`room:${game.id}:witch`);
    }
  }

  private emitLobbyUpdate() {
    this.io.emit("lobby:updated", { games: this.listGames() });
  }

  // --------------- Global Sleep (eyes closed) ---------------
  // Short randomized pause between major wakes so everyone closes eyes.
  private globalSleep(game: Game, next: () => void) {
    const min = Math.max(0, CONFIG.NEXT_WAKE_DELAY_MIN_MS);
    const max = Math.max(min, CONFIG.NEXT_WAKE_DELAY_MAX_MS);
    const pause = Math.floor(min + Math.random() * (max - min));
    (game as any).closingEyes = true;
    this.setDeadline(game, pause);
    this.broadcastState(game);
    for (const p of game.players) this.sendSnapshot(game, p.id);
    this.schedule(game.id, pause, () => {
      (game as any).closingEyes = false;
      this.broadcastState(game);
      next();
    });
  }

  // -------------------- Autostart and Roles --------------------
  private tryAutostart(game: Game) {
    if (game.players.length === game.maxPlayers && game.state === "LOBBY") {
      setState(game, "ROLES");
      assignRoles(game);
      // attach role rooms
      for (const p of game.players) {
        const s = this.io.sockets.sockets.get(p.socketId);
        if (s) this.bindPlayerToRooms(game, p, s);
      }
      // notify roles privately (include countdown duration from server config)
      for (const p of game.players) {
        this.io
          .to(p.socketId)
          .emit("role:assigned", {
            role: game.roles[p.id],
            countdownSeconds: CONFIG.COUNTDOWN_SECONDS,
            pressToRevealMs: CONFIG.TIME_PRESS_BEFOR_REVEAL_ROLE,
          });
      }
      this.broadcastState(game);
      this.log(game.id, "ROLES", undefined, "roles.assigned", {
        roles: "hidden",
      });
      // Wait for all players to click "ready" on the client before starting.
      // Next transition is triggered from playerReady() when everyone is ready.
    }
  }

  playerReady(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    const p = game.players.find((x) => x.id === playerId);
    if (!p) throw new Error("player_not_found");
    p.isReady = true;
    this.log(gameId, game.state, playerId, "player.ready");
    // Refresh readiness to everyone
    for (const pl of game.players) this.sendSnapshot(game, pl.id);
    const allReady = game.players.every((x) => x.isReady);
    if (allReady && game.state === "ROLES") {
      const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
      this.globalSleep(game, () => {
        if (cupid && game.alive.has(cupid.id) && cupid.connected) {
          this.beginNightCupid(game);
        } else {
          this.beginNightSeer(game);
        }
      });
    }
  }

  playerUnready(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    const p = game.players.find((x) => x.id === playerId);
    if (!p) throw new Error("player_not_found");
    p.isReady = false;
    this.log(gameId, game.state, playerId, "player.unready");
    // Refresh readiness to everyone
    for (const pl of game.players) this.sendSnapshot(game, pl.id);
  }

  // -------------------- Phases --------------------
  private beginNightCupid(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_CUPID")) return;
    setState(game, "NIGHT_CUPID");
    // réveiller Cupidon uniquement s'il est vivant et connecté
    const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
    const cid = cupid?.id;
    if (!cid || !game.alive.has(cid) || !cupid?.connected) {
      this.broadcastState(game);
      return this.beginNightSeer(game);
    }
    this.setDeadline(game, DURATION.CUPID_MS);
    this.broadcastState(game);
    const s = this.io.sockets.sockets.get(this.playerSocket(game, cid));
    if (s) {
      s.emit("cupid:wake", {
        alive: game.players
          .filter((p) => game.alive.has(p.id))
          .map((p) => this.playerLite(game, p.id)),
      });
    }
    this.log(game.id, game.state, cid, "cupid.wake");
    this.schedule(game.id, DURATION.CUPID_MS, () => this.endNightCupid(game.id));
  }

  cupidChoose(gameId: string, playerId: string, targetA: string, targetB: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_CUPID") throw new Error("bad_state");
    if (game.roles[playerId] !== "CUPID") throw new Error("forbidden");
    if (targetA === targetB) throw new Error("invalid_targets");
    const a = game.players.find((p) => p.id === targetA);
    const b = game.players.find((p) => p.id === targetB);
    if (!a || !b) throw new Error("player_not_found");
    if (!game.alive.has(a.id) || !game.alive.has(b.id)) throw new Error("invalid_target");

    a.loverId = b.id;
    b.loverId = a.id;
    // loversMode: SAME_CAMP si même alignement initial, sinon MIXED_CAMPS
    const isWolf = (pid: string) => game.roles[pid] === "WOLF";
    game.loversMode = isWolf(a.id) === isWolf(b.id) ? "SAME_CAMP" : "MIXED_CAMPS";
    this.log(game.id, game.state, playerId, "cupid.pair", { a: a.id, b: b.id, mode: game.loversMode });

    this.endNightCupid(game.id);
  }

  private endNightCupid(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_CUPID") return;
    const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
    const cid = cupid?.id;
    if (cid) {
      const s = this.io.sockets.sockets.get(this.playerSocket(game, cid));
      if (s) s.emit("cupid:sleep");
    }
    this.globalSleep(game, () => this.beginNightLovers(game));
  }

  private beginNightLovers(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_LOVERS")) return;
    setState(game, "NIGHT_LOVERS");
    const lovers = game.players.filter(
      (p) => p.loverId && game.alive.has(p.id) && p.connected,
    );
    if (lovers.length === 0) {
      this.broadcastState(game);
      return this.globalSleep(game, () => this.beginNightSeer(game));
    }
    // Reset per-phase acknowledgements for lovers
    (game as any).loversAcks = new Set<string>();
    this.setDeadline(game, DURATION.LOVERS_MS);
    this.broadcastState(game);
    for (const lover of lovers) {
      const partnerId = lover.loverId!;
      const s = this.io.sockets.sockets.get(this.playerSocket(game, lover.id));
      if (s) s.emit("lovers:wake", { partnerId });
    }
    this.log(game.id, game.state, undefined, "lovers.wake", { count: lovers.length });
    this.schedule(game.id, DURATION.LOVERS_MS, () => this.endNightLovers(game.id));
  }

  private endNightLovers(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_LOVERS") return;
    this.globalSleep(game, () => this.beginNightSeer(game));
  }

  loversAck(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_LOVERS") throw new Error("bad_state");
    const p = game.players.find((x) => x.id === playerId);
    if (!p || !p.loverId) throw new Error("not_lover");
    const acks: Set<string> = (game as any).loversAcks ?? new Set<string>();
    acks.add(playerId);
    (game as any).loversAcks = acks;
    const loversIds = game.players
      .filter((x) => x.loverId && game.alive.has(x.id) && x.connected)
      .map((x) => x.id);
    const allAcked = loversIds.every((id) => acks.has(id));
    this.log(game.id, game.state, playerId, "lovers.ack", { acked: acks.size });
    if (allAcked) {
      // When both lovers have acknowledged, end the phase immediately
      // to keep the flow snappy and deterministic in tests.
      const lovers = game.players.filter((x) => x.loverId && game.alive.has(x.id) && x.connected);
      for (const lover of lovers) {
        const s = this.io.sockets.sockets.get(this.playerSocket(game, lover.id));
        if (s) s.emit('lovers:sleep');
      }
      this.endNightLovers(game.id);
    }
  }


  /**
   * Révèle immédiatement le rôle de `targetId` à la voyante `playerId`.
   * Utilitaire surtout employé dans les tests unitaires sans passer par
   * la phase complète de réveil/dormir. Les validations miment
   * exactement celles de {@link seerPeek}.
   */
  seerProbe(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_SEER") throw new Error("bad_state");
    if ((game.roles[playerId] as any) !== "SEER") throw new Error("forbidden");
    if (playerId === targetId) throw new Error("cannot_probe_self");
    if (!game.alive.has(targetId)) throw new Error("invalid_probe_target");
    const role = game.roles[targetId];
    const s = this.io.sockets.sockets.get(this.playerSocket(game, playerId));
    if (s) s.emit("seer:reveal", { playerId: targetId, role });
    (game as any).privateLog = (game as any).privateLog ?? {};
    ((game as any).privateLog[playerId] =
      (game as any).privateLog[playerId] ?? []).push({ playerId: targetId, role });
    this.log(game.id, game.state, playerId, "seer.probe", { targetId });
  }

  /**
   * Démarre la phase `NIGHT_SEER`.
   * La voyante se réveille, reçoit la liste des joueurs vivants
   * (hors elle-même) et dispose de quelques secondes pour choisir
   * une cible à sonder.
   */
  private beginNightSeer(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_SEER")) return;
    setState(game, "NIGHT_SEER");
    const seer = game.players.find((p) => game.roles[p.id] === "SEER");
    const sid = seer?.id;
    if (!sid || !game.alive.has(sid) || !seer?.connected) {
      this.broadcastState(game);
      return this.globalSleep(game, () => this.beginNightWolves(game));
    }

    this.setDeadline(game, DURATION.SEER_MS);
    this.broadcastState(game);

    const alive = game.players
      .filter((p) => p.id !== sid && game.alive.has(p.id))
      .map((p) => this.playerLite(game, p.id));
    const s = this.io.sockets.sockets.get(this.playerSocket(game, sid));
    // Réveil ciblé : seul le socket de la voyante reçoit l'évènement.
    if (s) s.emit("seer:wake", { alive });
    this.log(game.id, game.state, sid, "seer.wake", { targets: alive.length });

    this.schedule(game.id, DURATION.SEER_MS, () => this.endNightSeer(game.id));
  }

  /**
   * Traite la commande `seer:peek` envoyée par le client.
   * Vérifie la validité de la cible puis révèle son rôle uniquement
   * à la voyante avant de clôturer la phase.
   */
  seerPeek(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_SEER") throw new Error("bad_state");
    if (game.roles[playerId] !== "SEER") throw new Error("forbidden");
    if (targetId === playerId) throw new Error("invalid_target");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");

    const role = game.roles[targetId];
    const s = this.io.sockets.sockets.get(this.playerSocket(game, playerId));
    // La révélation est strictement privée.
    if (s) s.emit("seer:reveal", { playerId: targetId, role });
    this.log(game.id, game.state, playerId, "seer.peek", { targetId, role });

    // Audit interne : consigne de la vision pour la fin de partie.
    const logArr = ((game as any).privateLog ??= []);
    logArr.push({ round: game.round, seer: playerId, target: targetId, role });

    // Met la phase en pause jusqu'à l'ACK explicite de la voyante.
    this.pendingSeerAck.add(game.id);
    // Annule le timer et retire la deadline côté clients.
    this.cancelTimer(game.id);
    (game as any).deadlines = undefined as any;
    this.broadcastState(game);
  }

  // ACK de lecture par la Voyante après la révélation
  seerAck(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_SEER") return; // ignorer si mauvaise phase
    if (game.roles[playerId] !== "SEER") return; // ignorer si pas la voyante
    if (!this.pendingSeerAck.has(game.id)) return; // rien en attente
    this.pendingSeerAck.delete(game.id);
    this.endNightSeer(game.id);
  }

  private endNightSeer(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_SEER") return;
    const seer = game.players.find((p) => game.roles[p.id] === "SEER");
    const sid = seer?.id;
    if (sid && game.alive.has(sid)) {
      const s = this.io.sockets.sockets.get(this.playerSocket(game, sid));
      if (s) s.emit("seer:sleep");
    }
    this.globalSleep(game, () => this.beginNightWolves(game));
  }

  private beginNightWolves(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_WOLVES")) return;
    game.round += 1;
    game.night = {};
    game.wolvesChoices = {};
    setState(game, "NIGHT_WOLVES");
    const wolves = activeWolves(game);
    if (wolves.length === 0) {
      this.broadcastState(game);
      return this.beginNightWitch(game);
    }

    this.setDeadline(game, DURATION.WOLVES_MS);
    this.broadcastState(game);

    const targets = targetsForWolves(game).map((pid) =>
      this.playerLite(game, pid),
    );
    this.io
      .to(`room:${game.id}:wolves`)
      .emit("wolves:wake", { alive: targets });
    this.log(game.id, game.state, undefined, "wolves.wake", {
      targets: targets.length,
    });

    this.schedule(game.id, DURATION.WOLVES_MS, () =>
      this.endNightWolves(game.id),
    );
  }

  wolvesChoose(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_WOLVES") throw new Error("bad_state");
    if (game.roles[playerId] !== "WOLF") throw new Error("forbidden");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");
    if (game.roles[targetId] === "WOLF") throw new Error("invalid_target");
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && targetId === lover) throw new Error("cannot_target_lover");

    // Autorise le revote: on enregistre simplement le dernier choix du loup.
    // Côté client, le bouton peut se déverrouiller pour changer d'avis tant
    // que le consensus n'est pas atteint.
    //
    // Utilise une copie immuable pour éviter les objets non extensibles ou
    // gelés qui ignorent l'affectation directe et empêchent d'enregistrer
    // correctement le vote.
    game.wolvesChoices = { ...game.wolvesChoices, [playerId]: targetId };
    const { consensus, target } = isConsensus(game);
    const wolvesActive = activeWolves(game);

    // Si, après ce choix, tous les loups vivants/connexes ont choisi "targetId",
    // verrouiller immédiatement avec cette cible explicite (pour éviter tout "null").
    const unanimousNow = wolvesActive.length > 0 && wolvesActive.every((w) => game.wolvesChoices[w] === targetId);
    if (unanimousNow) {
      this.io.to(`room:${game.id}:wolves`).emit("wolves:targetLocked", {
        targetId,
        confirmationsRemaining: 0,
      });
      this.log(game.id, game.state, playerId, "wolves.choose", { targetId });
      game.night.attacked = targetId;
      this.endNightWolves(game.id);
      return;
    }

    const confirmations = wolvesActive.filter(
      (w) => target && game.wolvesChoices[w] === target,
    ).length;
    const confirmationsRemaining = Math.max(wolvesActive.length - confirmations, 1);

    this.io.to(`room:${game.id}:wolves`).emit("wolves:targetLocked", {
      targetId: target ?? null,
      confirmationsRemaining,
    });
    this.log(game.id, game.state, playerId, "wolves.choose", { targetId });

    // Tous les loups vivants et connectés ont voté mais pas de consensus:
    // on émet un petit récap (wolves:results) pour indiquer l'égalité.
    // Les loups peuvent alors revoter jusqu'au consensus ou au timeout
    const wolvesActive2 = activeWolves(game);
    const allChosen = wolvesActive2.every((w) => !!game.wolvesChoices[w]);
    if (allChosen && !consensus) {
      const tally: Record<string, number> = {};
      for (const w of wolvesActive2) {
        const t = game.wolvesChoices[w];
        if (!t) continue;
        if (!game.alive.has(t)) continue;
        if (game.roles[t] === "WOLF") continue; // sécurité côté serveur
        tally[t] = (tally[t] ?? 0) + 1;
      }
      this.io.to(`room:${game.id}:wolves`).emit("wolves:results", { tally });
      this.log(game.id, game.state, undefined, "wolves.results", { tie: true });
    }

    if (consensus && target) {
      game.night.attacked = target;
      // fin anticipée de la phase
      this.endNightWolves(game.id);
    }
  }

  private endNightWolves(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_WOLVES") return; // déjà passé
    // Si pas de consensus ou pas de choix: aucune attaque
    const { consensus, target } = isConsensus(game);
    game.night.attacked = consensus ? target : undefined;
    const wolves = activeWolves(game);
    if (wolves.length > 0) this.io.to(`room:${game.id}:wolves`).emit("wolves:sleep");
    this.globalSleep(game, () => this.beginNightWitch(game));
  }

  private beginNightWitch(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_WITCH")) return;
    setState(game, "NIGHT_WITCH");

    const wid = witchId(game);
    const wp = wid ? game.players.find((p) => p.id === wid) : undefined;
    // S'il n'y a pas de sorcière vivante ou connectée, on passe directement à la phase suivante
    if (!wid || !game.alive.has(wid) || !wp?.connected) {
      this.broadcastState(game);
      return this.globalSleep(game, () => this.beginMorning(game));
    }

    this.setDeadline(game, DURATION.WITCH_MS);
    this.broadcastState(game);

    const attacked = game.night.attacked;
    const s = this.io.sockets.sockets.get(this.playerSocket(game, wid));
    if (s) {
      s.emit("witch:wake", {
        attacked,
        healAvailable: !game.inventory.witch.healUsed && !!attacked,
        poisonAvailable: !game.inventory.witch.poisonUsed,
        alive: targetsForWitch(game).map((pid) => this.playerLite(game, pid)),
      });
    }
    this.log(game.id, game.state, wid, "witch.wake", {
      attacked: attacked ?? null,
    });

    this.schedule(game.id, DURATION.WITCH_MS, () =>
      this.endNightWitch(game.id),
    );
  }

  witchDecision(
    gameId: string,
    playerId: string,
    save: boolean,
    poisonTargetId?: string,
  ) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_WITCH") throw new Error("bad_state");
    if (game.roles[playerId] !== "WITCH") throw new Error("forbidden");

    // save
    if (save) {
      if (!game.night.attacked) throw new Error("nothing_to_save");
      if (game.inventory.witch.healUsed) throw new Error("heal_already_used");
      game.night.saved = game.night.attacked; // auto-soin autorisé si cible = witch
      game.inventory.witch.healUsed = true;
    }
    // poison
    if (poisonTargetId) {
      if (game.inventory.witch.poisonUsed)
        throw new Error("poison_already_used");
      if (poisonTargetId === playerId) throw new Error("cannot_poison_self");
      if (!game.alive.has(poisonTargetId))
        throw new Error("invalid_poison_target");
      const lover = game.players.find((p) => p.id === playerId)?.loverId;
      if (lover && lover === poisonTargetId)
        throw new Error("cannot_target_lover");
      game.night.poisoned = poisonTargetId;
      game.inventory.witch.poisonUsed = true;
    }

    this.log(game.id, game.state, playerId, "witch.decision", {
      saved: !!game.night.saved,
      poisoned: !!game.night.poisoned,
    });

    this.endNightWitch(game.id);
  }

  hunterShoot(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    const key = `${gameId}:${playerId}`;
    const pending = this.hunterAwaiting.get(key);
    if (!pending) throw new Error("no_pending_shot");
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && lover === targetId) throw new Error("cannot_target_lover");
    if (!pending.alive.includes(targetId)) throw new Error("invalid_target");
    clearTimeout(pending.timer);
    this.hunterAwaiting.delete(key);
    pending.resolve(targetId);
    this.log(gameId, "HUNTER", playerId, "hunter.shoot", { targetId });
  }

  private async endNightWitch(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "NIGHT_WITCH") return;
    const wid = witchId(game);
    const wp = wid ? game.players.find((p) => p.id === wid) : undefined;
    if (wid && game.alive.has(wid) && wp?.connected) {
      const s = this.io.sockets.sockets.get(this.playerSocket(game, wid));
      if (s) s.emit('witch:sleep');
    }
    this.globalSleep(game, () => this.beginMorning(game));
  }

  private async beginMorning(game: Game) {
    if (!canTransition(game, game.state, "MORNING")) return;

    const initial = await computeNightDeaths(game);
    for (const v of initial) onPlayerDeath(game, v, 'NIGHT');
    const { deaths } = await resolveDeaths(game, undefined, { deferGrief: true });

    // Start with direct night deaths
    let allDeaths = [...deaths];

    // Track hunters that must shoot after the recap acknowledgment
    let hunters = deaths.filter((pid) => game.roles[pid] === "HUNTER");

    // If no hunter died directly at night, apply lovers' grief immediately so the
    // morning recap reflects both members of the couple. Hunters who die of grief
    // are scheduled to shoot during the MORNING acknowledgment step.
    if (hunters.length === 0 && (game.deferredGrief?.length ?? 0) > 0) {
      for (const vid of game.deferredGrief ?? []) {
        const lover = game.players.find((p) => p.id === vid)?.loverId;
        if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, 'GRIEF');
      }
      game.deferredGrief = [];
      const { deaths: griefDeaths } = await resolveDeaths(game, undefined, { deferGrief: false });
      allDeaths.push(...griefDeaths);
      const griefHunters = griefDeaths.filter((pid) => game.roles[pid] === "HUNTER");
      if (griefHunters.length > 0) hunters = hunters.concat(griefHunters);
    }

    if (hunters.length > 0) this.pendingHunters.set(game.id, hunters);

    const recap = {
      deaths: allDeaths.map((pid) => ({ playerId: pid, role: game.roles[pid] })),
      hunterKills: [] as string[],
    };
    this.morningRecaps.set(game.id, recap);

    // informer immédiatement les clients des morts de la nuit
    for (const p of game.players) {
      this.sendSnapshot(game, p.id);
    }
    this.io.to(`room:${game.id}`).emit("day:recap", recap);
    this.log(game.id, game.state, undefined, "day.recap", {
      deaths: deaths.length,
      hunterKills: 0,
    });

    setState(game, "MORNING");
    this.broadcastState(game);

    // Do not declare a winner while a hunter shot is pending
    const pending = this.pendingHunters.get(game.id) ?? [];
    const win = pending.length > 0 ? null : winner(game);
    if (win) {
      setState(game, "END");
      this.broadcastState(game);
      const roles = game.players.map((p) => ({
        playerId: p.id,
        role: game.roles[p.id],
      }));
      const lovers = game.players.filter((p) => !!p.loverId).map((p) => p.id);
      this.io.to(`room:${game.id}`).emit("game:ended", { winner: win, roles, lovers });
      this.log(game.id, "END", undefined, "game.end", { winner: win });
      return;
    }

    game.morningAcks.clear();
    this.setDeadline(game, DURATION.MORNING_MS);
    this.broadcastState(game);

    // attente des acks OU timeout
    this.schedule(game.id, DURATION.MORNING_MS, () =>
      this.handleMorningEnd(game),
    );
  }

  dayAck(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "MORNING") throw new Error("bad_state");
    game.morningAcks.add(playerId);
    this.log(game.id, game.state, playerId, "day.ack");
    const needed = game.alive.size;
    if (game.morningAcks.size >= needed) {
      this.handleMorningEnd(game);
    }
  }

  private async handleMorningEnd(game: Game) {
    if (game.state !== "MORNING") return;
    const pending = this.pendingHunters.get(game.id) ?? [];
    const recap = this.morningRecaps.get(game.id);
    if (pending.length > 0 && recap) {
      for (const hid of pending) {
        const alive = alivePlayers(game);
        const target = await this.askHunterTarget(game, hid, alive);
        if (target && game.alive.has(target)) {
          onPlayerDeath(game, target, 'HUNTER');
          // Après avoir planifié le tir du chasseur, traiter les chagrins d'amour différés
          for (const vid of game.deferredGrief ?? []) {
            const lover = game.players.find((p) => p.id === vid)?.loverId;
            if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, 'GRIEF');
          }
          game.deferredGrief = [];
          const { deaths, hunterShots } = await resolveDeaths(
            game,
            (h, a) => this.askHunterTarget(game, h, a),
          );
          recap.deaths.push(
            ...deaths.map((pid) => ({ playerId: pid, role: game.roles[pid] })),
          );
          // Include the hunter's chosen target in the recap along with any
          // additional kills caused by chained hunter shots.
          recap.hunterKills.push(target, ...hunterShots.map((s) => s.targetId));
        }
      }
      for (const p of game.players) {
        this.sendSnapshot(game, p.id);
      }
      this.io.to(`room:${game.id}`).emit("day:recap", recap);
      this.log(game.id, "MORNING", undefined, "day.recap", {
        deaths: recap.deaths.length,
        hunterKills: recap.hunterKills.length,
      });
      this.pendingHunters.delete(game.id);
      this.morningRecaps.set(game.id, recap);

      // Survivors must acknowledge the updated recap before proceeding
      game.morningAcks.clear();
      this.setDeadline(game, DURATION.MORNING_MS);
      this.broadcastState(game);
      this.schedule(game.id, DURATION.MORNING_MS, () => this.handleMorningEnd(game));
      return;
    }

    // If the morning included a hunter shot recap, always proceed to a vote
    // once survivors have acknowledged. Even if a theoretical win condition
    // (wolves >= others) is met, finish the day flow consistently.
    const hadHunterShot = !!recap && recap.hunterKills.length > 0;
    if (hadHunterShot) {
      this.beginVote(game);
      return;
    }

    const win = winner(game);
    if (win) {
      setState(game, "END");
      this.broadcastState(game);
      const roles = game.players.map((p) => ({
        playerId: p.id,
        role: game.roles[p.id],
      }));
      this.io.to(`room:${game.id}`).emit("game:ended", { winner: win, roles });
      this.log(game.id, "END", undefined, "game.end", { winner: win });
      return;
    }

    this.beginVote(game);
  }

  private beginVote(game: Game) {
    if (!canTransition(game, game.state, "VOTE")) return;
    // Garde pédagogique:
    // Si un vainqueur est déjà déterminé (ex.: dernier survivant, ou 2 amoureux
    // de camps différents encore en vie), on conclut immédiatement au lieu
    // d'ouvrir un vote inutile.
    const win = winner(game);
    if (win) {
      setState(game, "END");
      this.broadcastState(game);
      const roles = game.players.map((p) => ({
        playerId: p.id,
        role: game.roles[p.id],
      }));
      const lovers = game.players.filter((p) => !!p.loverId).map((p) => p.id);
      this.io.to(`room:${game.id}`).emit("game:ended", { winner: win, roles, lovers });
      this.log(game.id, "END", undefined, "game.end", { winner: win });
      return;
    }
    setState(game, "VOTE");
    game.votes = {};
    game.deadlines = {};
    this.broadcastState(game);

    const alive = alivePlayers(game).map((pid) => this.playerLite(game, pid));
    this.io.to(`room:${game.id}`).emit("vote:options", { alive });
    this.log(game.id, game.state, undefined, "vote.begin", {
      alive: alive.length,
    });
  }

  voteCast(gameId: string, playerId: string, targetId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "VOTE") throw new Error("bad_state");
    if (!game.alive.has(playerId)) throw new Error("dead_cannot_vote");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && lover === targetId) throw new Error("cannot_target_lover");
    game.votes[playerId] = targetId;
    this.log(game.id, game.state, playerId, "vote.cast", { targetId });

    const aliveIds = alivePlayers(game);
    // Early resolution: if any target has an absolute majority of alive players,
    // finalize the vote immediately without waiting for remaining ballots.
    const majority = Math.floor(aliveIds.length / 2) + 1;
    const tally: Record<string, number> = {};
    for (const pid of aliveIds) {
      const t = game.votes[pid];
      if (!t) continue;
      if (!game.alive.has(t)) continue;
      tally[t] = (tally[t] ?? 0) + 1;
      if (tally[t] >= majority) {
        this.endVote(game.id);
        return;
      }
    }

    // Otherwise, if all alive have voted, close the round
    const allVoted = aliveIds.every((pid) => pid in game.votes);
    if (allVoted) this.endVote(game.id);
  }

  voteCancel(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "VOTE") throw new Error("bad_state");
    delete game.votes[playerId];
    this.log(game.id, game.state, playerId, "vote.cancel");
  }

  private async endVote(gameId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== "VOTE") return;
    const { eliminated, tally } = computeVoteResult(game);
    const tie = !eliminated && Object.keys(tally).length > 0;
    if (tie) {
      // Égalité: on affiche le résultat sans élimination, puis on relance
      // un nouveau tour de vote après un court délai (3s) pour la lisibilité.
      // L'UI reste en phase VOTE et reçoit un nouvel événement vote:options.
      this.io.to(`room:${game.id}`).emit("vote:results", {
        eliminatedId: null,
        role: null,
        tally,
      });
      this.log(game.id, "VOTE", undefined, "vote.results", {
        eliminated: null,
        tie: true,
      });
      setTimeout(() => {
        game.votes = {};
        game.deadlines = {};
        const alive = alivePlayers(game).map((pid) =>
          this.playerLite(game, pid),
        );
        this.io.to(`room:${game.id}`).emit("vote:options", { alive });
        this.log(game.id, "VOTE", undefined, "vote.revote", {
          alive: alive.length,
        });
        this.broadcastState(game);
      }, 3_000);
      return;
    }

    // Passage en phase RESOLVE: résolution des effets de l'élimination
    // (ex.: tir du chasseur, chagrin d'amour), puis vérification de fin.
    setState(game, "RESOLVE");
    if (eliminated) {
      onPlayerDeath(game, eliminated, 'VOTE');
      // Traiter également d'éventuels chagrins d'amour différés avant résolution
      for (const vid of game.deferredGrief ?? []) {
        const lover = game.players.find((p) => p.id === vid)?.loverId;
        if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, 'GRIEF');
      }
      game.deferredGrief = [];
      await resolveDeaths(game, (hid, alive) =>
        this.askHunterTarget(game, hid, alive),
      );
    }

    this.io.to(`room:${game.id}`).emit("vote:results", {
      eliminatedId: eliminated ?? null,
      role: eliminated ? game.roles[eliminated] : null,
      tally,
    });
    this.log(game.id, "RESOLVE", undefined, "vote.results", {
      eliminated: eliminated ?? null,
    });
    // Si pas de gagnant immédiat et une élimination a eu lieu,
    // attendre l'ACK du joueur éliminé avant de poursuivre vers la nuit.
    const winNow = winner(game);
    if (!winNow && eliminated) {
      this.pendingDayElimAck.set(game.id, eliminated);
      return;
    }
    this.beginCheckEnd(game);
  }

  voteAck(gameId: string, playerId: string) {
    const game = this.mustGet(gameId);
    if (game.state !== 'RESOLVE') return;
    const pending = this.pendingDayElimAck.get(game.id);
    if (!pending || pending !== playerId) return;
    this.pendingDayElimAck.delete(game.id);
    this.beginCheckEnd(game);
  }

  private beginCheckEnd(game: Game) {
    setState(game, "CHECK_END");
    // Vérifie si une condition de victoire est atteinte. Si oui, phase END
    // (et publication des rôles); sinon, retour à la nuit.
    const win = winner(game);
    if (win) {
      setState(game, "END");
      this.broadcastState(game);
      const roles = game.players.map((p) => ({
        playerId: p.id,
        role: game.roles[p.id],
      }));
      const lovers = game.players.filter((p) => !!p.loverId).map((p) => p.id);
      this.io.to(`room:${game.id}`).emit("game:ended", { winner: win, roles, lovers });
      this.log(game.id, "END", undefined, "game.end", { winner: win });
    } else {
      this.globalSleep(game, () => this.beginNightSeer(game));
    }
  }

  // -------------------- Helpers --------------------
  private mustGet(gameId: string): Game {
    const g = this.store.get(gameId);
    if (!g) throw new Error("game_not_found");
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

  private cancelTimer(gameId: string) {
    const old = this.timers.get(gameId);
    if (old) {
      clearTimeout(old);
      this.timers.delete(gameId);
    }
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

  private askHunterTarget(
    game: Game,
    hunterId: string,
    alive: string[],
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const socketId = this.playerSocket(game, hunterId);
      const s = this.io.sockets.sockets.get(socketId);
      if (!s) {
        resolve(undefined);
        return;
      }
      const lover = game.players.find((p) => p.id === hunterId)?.loverId;
      const options = alive.filter((pid) => pid !== hunterId && pid !== lover);
      const key = `${game.id}:${hunterId}`;
      const timer = setTimeout(() => {
        this.hunterAwaiting.delete(key);
        resolve(undefined);
      }, DURATION.HUNTER_MS);
      this.hunterAwaiting.set(key, { resolve, alive: options, timer });
      this.setDeadline(game, DURATION.HUNTER_MS);
      this.broadcastState(game);
      s.emit("hunter:wake", {
        alive: options.map((pid) => this.playerLite(game, pid)),
      });
      this.log(game.id, game.state, hunterId, "hunter.wake", {
        options: options.length,
      });
    });
  }

  private broadcastState(game: Game) {
    this.io.to(`room:${game.id}`).emit("game:stateChanged", {
      gameId: game.id,
      state: game.state,
      serverTime: Date.now(),
      deadline: game.deadlines?.phaseEndsAt ?? null,
      closingEyes: (game as any).closingEyes === true,
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
      closingEyes: (game as any).closingEyes === true,
    };
    this.io.to(you.socketId).emit("game:snapshot", sanitized);
  }

  markDisconnected(socket: Socket) {
    for (const g of this.store.all()) {
      const p = g.players.find((x) => x.socketId === socket.id);
      if (p) {
        p.connected = false;
        p.lastSeen = now();
        this.log(g.id, g.state, p.id, "player.disconnected");
        // Si un ACK d'élimination de jour est en attente pour ce joueur,
        // considérer la déconnexion comme un ACK explicite.
        if (g.state === 'RESOLVE' && this.pendingDayElimAck.get(g.id) === p.id) {
          this.pendingDayElimAck.delete(g.id);
          this.beginCheckEnd(g);
        }
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

