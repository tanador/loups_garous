import type { Socket } from "socket.io";
import type { Game, Player } from "../../domain/types.js";
import { createGame as makeGame, addPlayer, removePlayer } from "../../domain/game.js";
import { assignRoles } from "../../domain/rules.js";
import { setState } from "../../domain/fsm.js";
import { CONFIG } from "../timers.js";
import type { OrchestratorContext } from "./context.js";
import { mustGet } from "./utils.js";

export function createLobbyApi(ctx: OrchestratorContext) {
  function listGames() {
    return ctx.store.listLobby();
  }

  function bindPlayerToRooms(game: Game, player: Player, socket: Socket) {
    socket.join(`room:${game.id}`);
    if (game.roles[player.id]) {
      const role = game.roles[player.id];
      if (role === "WOLF") socket.join(`room:${game.id}:wolves`);
      if (role === "WITCH") socket.join(`room:${game.id}:witch`);
    }
  }

  function tryAutostart(game: Game) {
    if (game.players.length === game.maxPlayers && game.state === "LOBBY") {
      setState(game, "ROLES");
      assignRoles(game);
      for (const p of game.players) {
        const socket = ctx.io.sockets.sockets.get(p.socketId);
        if (socket) bindPlayerToRooms(game, p, socket);
      }
      for (const p of game.players) {
        ctx.io.to(p.socketId).emit("role:assigned", {
          role: game.roles[p.id],
          countdownSeconds: CONFIG.COUNTDOWN_SECONDS,
          pressToRevealMs: CONFIG.TIME_PRESS_BEFOR_REVEAL_ROLE,
        });
      }
      ctx.helpers.broadcastState(game);
      ctx.log(game.id, "ROLES", undefined, "roles.assigned", { roles: "hidden" });
    }
  }

  function createGame(nickname: string, maxPlayers: number, socket: Socket) {
    const game = makeGame(maxPlayers);
    const player: Player = addPlayer(game, {
      id: nickname,
      socketId: socket.id,
    });
    ctx.store.put(game);
    bindPlayerToRooms(game, player, socket);
    ctx.helpers.sendSnapshot(game, player.id);
    ctx.helpers.emitLobbyUpdate();
    ctx.log(game.id, "LOBBY", player.id, "lobby.create", { maxPlayers });
    tryAutostart(game);
    return {
      gameId: game.id,
      playerId: player.id,
      maxPlayers: game.maxPlayers,
    };
  }

  function joinGame(gameId: string, nickname: string, socket: Socket) {
    const game = ctx.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    if (game.players.length >= game.maxPlayers) throw new Error("game_full");

    const player: Player = addPlayer(game, {
      id: nickname,
      socketId: socket.id,
    });
    bindPlayerToRooms(game, player, socket);
    ctx.store.put(game);
    ctx.helpers.emitLobbyUpdate();
    ctx.helpers.sendSnapshot(game, player.id);
    ctx.log(game.id, "LOBBY", player.id, "lobby.join");
    tryAutostart(game);
    return {
      gameId: game.id,
      playerId: player.id,
      maxPlayers: game.maxPlayers,
    };
  }

  function cancelGame(gameId: string, playerId: string) {
    const game = ctx.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.players[0]?.id !== playerId) throw new Error("not_owner");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    ctx.store.del(gameId);
    ctx.io.to(`room:${gameId}`).emit("game:cancelled", {});
    ctx.helpers.emitLobbyUpdate();
    ctx.log(gameId, "LOBBY", playerId, "lobby.cancel");
  }

  function leaveGame(gameId: string, playerId: string) {
    const game = ctx.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    if (game.state !== "LOBBY") throw new Error("game_already_started");
    if (game.players[0]?.id === playerId) {
      cancelGame(gameId, playerId);
      return;
    }
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    removePlayer(game, playerId);
    ctx.store.put(game);
    ctx.helpers.emitLobbyUpdate();
    for (const p of game.players) ctx.helpers.sendSnapshot(game, p.id);
    ctx.log(gameId, "LOBBY", playerId, "lobby.leave");
  }

  function resume(gameId: string, playerId: string, socket: Socket) {
    const game = ctx.store.get(gameId);
    if (!game) throw new Error("game_not_found");
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");

    player.socketId = socket.id;
    player.connected = true;
    player.lastSeen = Date.now();
    bindPlayerToRooms(game, player, socket);
    ctx.helpers.sendSnapshot(game, playerId);
    ctx.log(game.id, game.state, playerId, "session.resume");
  }

  function playerReady(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    player.isReady = true;
    ctx.log(gameId, game.state, playerId, "player.ready");
    for (const p of game.players) ctx.helpers.sendSnapshot(game, p.id);
    const allReady = game.players.every((p) => p.isReady);
    if (allReady && game.state === "ROLES") {
      const thief = game.players.find((p) => game.roles[p.id] === "THIEF");
      const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
      ctx.helpers.globalSleep(game, () => {
        if (thief && game.alive.has(thief.id) && thief.connected) {
          ctx.helpers.beginNightThief(game);
        } else if (cupid && game.alive.has(cupid.id) && cupid.connected) {
          ctx.helpers.beginNightCupid(game);
        } else {
          ctx.helpers.beginNightSeer(game);
        }
      });
    }
  }

  function playerUnready(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);
    const player = game.players.find((p) => p.id === playerId);
    if (!player) throw new Error("player_not_found");
    player.isReady = false;
    ctx.log(gameId, game.state, playerId, "player.unready");
    for (const p of game.players) ctx.helpers.sendSnapshot(game, p.id);
  }

  return {
    listGames,
    createGame,
    joinGame,
    cancelGame,
    leaveGame,
    resume,
    tryAutostart,
    playerReady,
    playerUnready,
    bindPlayerToRooms,
  };
}
