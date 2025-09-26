import type { Game } from "../../../domain/types.js";
import type { Role } from "../../../domain/roles/index.js";
import { canTransition, setState } from "../../../domain/fsm.js";
import {
  targetsForWolves,
  targetsForWitch,
  activeWolves,
  isConsensus,
  witchId,
} from "../../../domain/rules.js";
import { CONFIG, DURATION } from "../../timers.js";
import type { OrchestratorContext } from "../context.js";
import {
  ack,
  beginAck,
  cancelTimer,
  mustGet,
  scheduleTimer,
  setDeadline,
} from "../utils.js";

const ACK_LOVERS = (gameId: string) => `${gameId}:night:lovers`;
const ACK_SEER = (gameId: string) => `${gameId}:night:seer`;

const timerKey = (gameId: string, step: string) => `${gameId}:night:${step}`;

export function createNightApi(ctx: OrchestratorContext) {
  function globalSleep(game: Game, next: () => void) {
    const min = Math.max(0, CONFIG.NEXT_WAKE_DELAY_MIN_MS);
    const max = Math.max(min, CONFIG.NEXT_WAKE_DELAY_MAX_MS);
    const pause = Math.floor(min + Math.random() * (max - min));
    (game as any).closingEyes = true;
    setDeadline(ctx, game, pause);
    ctx.helpers.broadcastState(game);
    for (const p of game.players) ctx.helpers.sendSnapshot(game, p.id);
    scheduleTimer(ctx, timerKey(game.id, "sleep"), pause, () => {
      (game as any).closingEyes = false;
      ctx.helpers.broadcastState(game);
      next();
    });
  }

  function beginNightThief(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_THIEF")) return;
    setState(game, "NIGHT_THIEF");
    const thief = game.players.find((p) => game.roles[p.id] === "THIEF");
    const tid = thief?.id;
    if (!tid || !game.alive.has(tid) || !thief?.connected) {
      ctx.helpers.broadcastState(game);
      return beginNightCupid(game);
    }
    if (!game.centerCards || game.centerCards.length === 0) {
      ctx.helpers.broadcastState(game);
      return beginNightCupid(game);
    }
    setDeadline(ctx, game, DURATION.THIEF_MS);
    ctx.helpers.broadcastState(game);
    (game as any).currentThiefId = tid;
    const socket = thief ? ctx.io.sockets.sockets.get(thief.socketId) : undefined;
    if (socket) {
      socket.emit("thief:wake", {
        center: game.centerCards.map((r) => ({ role: r })),
      });
    }
    ctx.log(game.id, game.state, tid, "thief.wake");
    scheduleTimer(ctx, timerKey(game.id, "thief"), DURATION.THIEF_MS, () => endNightThief(game.id));
  }

  function thiefChoose(gameId: string, playerId: string, action: "keep" | "swap", index?: number) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_THIEF") throw new Error("bad_state");
    if (game.roles[playerId] !== "THIEF") throw new Error("forbidden");
    if (!game.centerCards || game.centerCards.length !== 2) throw new Error("no_center");
    const [c0, c1] = game.centerCards;
    const mustTakeWolf = c0 === "WOLF" && c1 === "WOLF";
    if (mustTakeWolf && action === "keep") throw new Error("must_take_wolf");
    if (action === "swap") {
      if (index !== 0 && index !== 1) throw new Error("invalid_index");
      const oldRole = game.roles[playerId] as Role;
      const newRole = (index === 0 ? c0 : c1) as Role;
      if (index === 0) game.centerCards = [oldRole, c1];
      else game.centerCards = [c0, oldRole];
      game.roles[playerId] = newRole;
      const player = game.players.find((x) => x.id === playerId)!;
      player.role = newRole;
      const socket = ctx.io.sockets.sockets.get(player.socketId);
      if (socket) {
        if (oldRole === "WOLF") socket.leave(`room:${game.id}:wolves`);
        if (newRole === "WOLF") socket.join(`room:${game.id}:wolves`);
        if (oldRole === "WITCH") socket.leave(`room:${game.id}:witch`);
        if (newRole === "WITCH") socket.join(`room:${game.id}:witch`);
      }
      ctx.log(game.id, game.state, playerId, "thief.swap", { newRole });
    } else {
      ctx.log(game.id, game.state, playerId, "thief.keep");
    }
    endNightThief(game.id);
  }

  function endNightThief(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_THIEF") return;
    const tid = (game as any).currentThiefId as string | undefined;
    if (tid) {
      const socketId = game.players.find((p) => p.id === tid)?.socketId;
      const socket = socketId ? ctx.io.sockets.sockets.get(socketId) : undefined;
      if (socket) socket.emit("thief:sleep");
    }
    (game as any).currentThiefId = undefined;
    globalSleep(game, () => beginNightCupid(game));
  }

  function beginNightCupid(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_CUPID")) return;
    setState(game, "NIGHT_CUPID");
    const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
    const cid = cupid?.id;
    if (!cid || !game.alive.has(cid) || !cupid?.connected) {
      ctx.helpers.broadcastState(game);
      return beginNightSeer(game);
    }
    setDeadline(ctx, game, DURATION.CUPID_MS);
    ctx.helpers.broadcastState(game);
    const socket = ctx.io.sockets.sockets.get(cupid.socketId);
    if (socket) {
      socket.emit("cupid:wake", {
        alive: game.players
          .filter((p) => game.alive.has(p.id))
          .map((p) => ({ id: p.id })),
      });
    }
    ctx.log(game.id, game.state, cid, "cupid.wake");
    scheduleTimer(ctx, timerKey(game.id, "cupid"), DURATION.CUPID_MS, () => endNightCupid(game.id));
  }

  function cupidChoose(gameId: string, playerId: string, targetA: string, targetB: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_CUPID") throw new Error("bad_state");
    if (game.roles[playerId] !== "CUPID") throw new Error("forbidden");
    if (targetA === targetB) throw new Error("invalid_targets");
    const a = game.players.find((p) => p.id === targetA);
    const b = game.players.find((p) => p.id === targetB);
    if (!a || !b) throw new Error("player_not_found");
    if (!game.alive.has(a.id) || !game.alive.has(b.id)) throw new Error("invalid_target");

    a.loverId = b.id;
    b.loverId = a.id;
    const isWolf = (pid: string) => game.roles[pid] === "WOLF";
    game.loversMode = isWolf(a.id) === isWolf(b.id) ? "SAME_CAMP" : "MIXED_CAMPS";
    ctx.log(game.id, game.state, playerId, "cupid.pair", { a: a.id, b: b.id, mode: game.loversMode });

    endNightCupid(game.id);
  }

  function endNightCupid(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_CUPID") return;
    const cupid = game.players.find((p) => game.roles[p.id] === "CUPID");
    if (cupid) {
      const socket = ctx.io.sockets.sockets.get(cupid.socketId);
      if (socket) socket.emit("cupid:sleep");
    }
    globalSleep(game, () => beginNightLovers(game));
  }

  function beginNightLovers(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_LOVERS")) return;
    setState(game, "NIGHT_LOVERS");
    const lovers = game.players.filter((p) => p.loverId && game.alive.has(p.id) && p.connected);
    if (lovers.length === 0) {
      ctx.helpers.broadcastState(game);
      return globalSleep(game, () => beginNightSeer(game));
    }
    const loverIds = new Set(lovers.map((p) => p.id));
    beginAck(ctx, ACK_LOVERS(game.id), loverIds);
    setDeadline(ctx, game, DURATION.LOVERS_MS);
    ctx.helpers.broadcastState(game);
    for (const lover of lovers) {
      const partnerId = lover.loverId!;
      const socket = ctx.io.sockets.sockets.get(lover.socketId);
      if (socket) socket.emit("lovers:wake", { partnerId });
    }
    ctx.log(game.id, game.state, undefined, "lovers.wake", { count: lovers.length });
    scheduleTimer(ctx, timerKey(game.id, "lovers"), DURATION.LOVERS_MS, () => endNightLovers(game.id));
  }

  function endNightLovers(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_LOVERS") return;
    ctx.waitlists.acks.delete(ACK_LOVERS(game.id));
    globalSleep(game, () => beginNightSeer(game));
  }

  function loversAck(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_LOVERS") throw new Error("bad_state");
    const player = game.players.find((x) => x.id === playerId);
    if (!player || !player.loverId) throw new Error("not_lover");
    const key = ACK_LOVERS(game.id);
    if (!ctx.waitlists.acks.has(key)) {
      const expected = new Set(
        game.players
          .filter((p) => p.loverId && game.alive.has(p.id) && p.connected)
          .map((p) => p.id),
      );
      beginAck(ctx, key, expected);
    }
    const completed = ack(ctx, key, playerId);
    ctx.log(game.id, game.state, playerId, "lovers.ack");
    if (completed) {
      const lovers = game.players.filter((p) => p.loverId && game.alive.has(p.id) && p.connected);
      for (const lover of lovers) {
        const socket = ctx.io.sockets.sockets.get(lover.socketId);
        if (socket) socket.emit("lovers:sleep");
      }
      ctx.waitlists.acks.delete(key);
      endNightLovers(game.id);
    }
  }


  function beginNightSeer(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_SEER")) return;
    setState(game, "NIGHT_SEER");
    const seer = game.players.find((p) => game.roles[p.id] === "SEER");
    const sid = seer?.id;
    if (!sid || !game.alive.has(sid) || !seer?.connected) {
      ctx.helpers.broadcastState(game);
      return globalSleep(game, () => beginNightWolves(game));
    }
    setDeadline(ctx, game, DURATION.SEER_MS);
    ctx.helpers.broadcastState(game);
    const alive = game.players
      .filter((p) => p.id !== sid && game.alive.has(p.id))
      .map((p) => ({ id: p.id }));
    const socket = ctx.io.sockets.sockets.get(seer.socketId);
    if (socket) socket.emit("seer:wake", { alive });
    ctx.log(game.id, game.state, sid, "seer.wake", { targets: alive.length });
    scheduleTimer(ctx, timerKey(game.id, "seer"), DURATION.SEER_MS, () => endNightSeer(game.id));
  }

  function seerPeek(gameId: string, playerId: string, targetId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_SEER") throw new Error("bad_state");
    if (game.roles[playerId] !== "SEER") throw new Error("forbidden");
    if (targetId === playerId) throw new Error("invalid_target");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");

    const role = game.roles[targetId];
    const socket = ctx.io.sockets.sockets.get(game.players.find((p) => p.id === playerId)?.socketId ?? "");
    if (socket) socket.emit("seer:reveal", { playerId: targetId, role });
    ctx.log(game.id, game.state, playerId, "seer.peek", { targetId, role });

    const logArr = ((game as any).privateLog ??= []);
    logArr.push({ round: game.round, seer: playerId, target: targetId, role });

    beginAck(ctx, ACK_SEER(game.id), new Set([playerId]));
    cancelTimer(ctx, timerKey(game.id, "seer"));
    (game as any).deadlines = undefined as any;
    ctx.helpers.broadcastState(game);
  }

  function seerAck(gameId: string, playerId: string) {
    const key = ACK_SEER(gameId);
    const done = ack(ctx, key, playerId);
    if (!done) return;
    ctx.waitlists.acks.delete(key);
    endNightSeer(gameId);
  }

  function endNightSeer(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_SEER") return;
    const seer = game.players.find((p) => game.roles[p.id] === "SEER");
    if (seer && game.alive.has(seer.id)) {
      const socket = ctx.io.sockets.sockets.get(seer.socketId);
      if (socket) socket.emit("seer:sleep");
    }
    ctx.waitlists.acks.delete(ACK_SEER(game.id));
    globalSleep(game, () => beginNightWolves(game));
  }

  function beginNightWolves(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_WOLVES")) return;
    game.round += 1;
    game.night = {};
    game.wolvesChoices = {};
    setState(game, "NIGHT_WOLVES");
    const wolves = activeWolves(game);
    if (wolves.length === 0) {
      ctx.helpers.broadcastState(game);
      return beginNightWitch(game);
    }
    setDeadline(ctx, game, DURATION.WOLVES_MS);
    ctx.helpers.broadcastState(game);
    const targets = targetsForWolves(game).map((pid) => ({ id: pid }));
    ctx.io.to(`room:${game.id}:wolves`).emit("wolves:wake", { alive: targets });
    ctx.log(game.id, game.state, undefined, "wolves.wake", { targets: targets.length });
    scheduleTimer(ctx, timerKey(game.id, "wolves"), DURATION.WOLVES_MS, () => endNightWolves(game.id));
  }

  function wolvesChoose(gameId: string, playerId: string, targetId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_WOLVES") throw new Error("bad_state");
    if (game.roles[playerId] !== "WOLF") throw new Error("forbidden");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");
    if (game.roles[targetId] === "WOLF") throw new Error("invalid_target");
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && targetId === lover) throw new Error("cannot_target_lover");

    game.wolvesChoices = { ...game.wolvesChoices, [playerId]: targetId };
    const { consensus, target } = isConsensus(game);
    const wolvesActive = activeWolves(game);
    const unanimousNow = wolvesActive.length > 0 && wolvesActive.every((w) => game.wolvesChoices[w] === targetId);
    if (unanimousNow) {
      ctx.io.to(`room:${game.id}:wolves`).emit("wolves:targetLocked", {
        targetId,
        confirmationsRemaining: 0,
      });
      ctx.log(game.id, game.state, playerId, "wolves.choose", { targetId });
      game.night.attacked = targetId;
      endNightWolves(game.id);
      return;
    }

    const confirmations = wolvesActive.filter((w) => target && game.wolvesChoices[w] === target).length;
    const confirmationsRemaining = Math.max(wolvesActive.length - confirmations, 1);

    ctx.io.to(`room:${game.id}:wolves`).emit("wolves:targetLocked", {
      targetId: target ?? null,
      confirmationsRemaining,
    });
    ctx.log(game.id, game.state, playerId, "wolves.choose", { targetId });

    const wolvesActive2 = activeWolves(game);
    const allChosen = wolvesActive2.every((w) => !!game.wolvesChoices[w]);
    if (allChosen && !consensus) {
      const tally: Record<string, number> = {};
      for (const w of wolvesActive2) {
        const t = game.wolvesChoices[w];
        if (!t) continue;
        if (!game.alive.has(t)) continue;
        if (game.roles[t] === "WOLF") continue;
        tally[t] = (tally[t] ?? 0) + 1;
      }
      ctx.io.to(`room:${game.id}:wolves`).emit("wolves:results", { tally });
      ctx.log(game.id, game.state, undefined, "wolves.results", { tie: true });
    }

    if (consensus && target) {
      game.night.attacked = target;
      endNightWolves(game.id);
    }
  }

  function endNightWolves(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_WOLVES") return;
    const { consensus, target } = isConsensus(game);
    game.night.attacked = consensus ? target : undefined;
    const wolves = activeWolves(game);
    if (wolves.length > 0) ctx.io.to(`room:${game.id}:wolves`).emit("wolves:sleep");
    globalSleep(game, () => beginNightWitch(game));
  }

  function beginNightWitch(game: Game) {
    if (!canTransition(game, game.state, "NIGHT_WITCH")) return;
    setState(game, "NIGHT_WITCH");
    const wid = witchId(game);
    const witch = wid ? game.players.find((p) => p.id === wid) : undefined;
    if (!wid || !game.alive.has(wid) || !witch?.connected) {
      ctx.helpers.broadcastState(game);
      return globalSleep(game, () => ctx.helpers.beginMorning(game));
    }
    setDeadline(ctx, game, DURATION.WITCH_MS);
    ctx.helpers.broadcastState(game);
    const attacked = game.night.attacked;
    const socket = ctx.io.sockets.sockets.get(witch.socketId);
    if (socket) {
      socket.emit("witch:wake", {
        attacked,
        healAvailable: !game.inventory.witch.healUsed && !!attacked,
        poisonAvailable: !game.inventory.witch.poisonUsed,
        alive: targetsForWitch(game).map((pid) => ({ id: pid })),
      });
    }
    ctx.log(game.id, game.state, wid, "witch.wake", { attacked: attacked ?? null });
    scheduleTimer(ctx, timerKey(game.id, "witch"), DURATION.WITCH_MS, () => endNightWitch(game.id));
  }

  function witchDecision(
    gameId: string,
    playerId: string,
    save: boolean,
    poisonTargetId?: string,
  ) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_WITCH") throw new Error("bad_state");
    if (game.roles[playerId] !== "WITCH") throw new Error("forbidden");

    if (save) {
      if (!game.night.attacked) throw new Error("nothing_to_save");
      if (game.inventory.witch.healUsed) throw new Error("heal_already_used");
      game.night.saved = game.night.attacked;
      game.inventory.witch.healUsed = true;
    }
    if (poisonTargetId) {
      if (game.inventory.witch.poisonUsed) throw new Error("poison_already_used");
      if (poisonTargetId === playerId) throw new Error("cannot_poison_self");
      if (!game.alive.has(poisonTargetId)) throw new Error("invalid_poison_target");
      const lover = game.players.find((p) => p.id === playerId)?.loverId;
      if (lover && lover === poisonTargetId) throw new Error("cannot_target_lover");
      game.night.poisoned = poisonTargetId;
      game.inventory.witch.poisonUsed = true;
    }

    ctx.log(game.id, game.state, playerId, "witch.decision", {
      saved: !!game.night.saved,
      poisoned: !!game.night.poisoned,
    });

    endNightWitch(game.id);
  }

  async function endNightWitch(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "NIGHT_WITCH") return;
    const wid = witchId(game);
    const witch = wid ? game.players.find((p) => p.id === wid) : undefined;
    if (wid && game.alive.has(wid) && witch?.connected) {
      const socket = ctx.io.sockets.sockets.get(witch.socketId);
      if (socket) socket.emit("witch:sleep");
    }
    globalSleep(game, () => ctx.helpers.beginMorning(game));
  }

  return {
    globalSleep,
    beginNightThief,
    thiefChoose,
    endNightThief,
    beginNightCupid,
    cupidChoose,
    endNightCupid,
    beginNightLovers,
    loversAck,
    endNightLovers,
    beginNightSeer,
    seerPeek,
    seerAck,
    endNightSeer,
    beginNightWolves,
    wolvesChoose,
    endNightWolves,
    beginNightWitch,
    witchDecision,
    endNightWitch,
  };
}

