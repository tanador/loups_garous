import type { Game } from "../../../domain/types.js";
import { canTransition, setState } from "../../../domain/fsm.js";
import {
  alivePlayers,
  computeVoteResult,
  enforceWolvesDomination,
  onPlayerDeath,
  resolveDeaths,
  winner,
} from "../../../domain/rules.js";
import type { OrchestratorContext } from "../context.js";
import { mustGet } from "../utils.js";

export type VoteApiDependencies = {
  pendingDayAcks: Set<string>;
  pendingDayElimAck: Map<string, string>;
  emitGameEnded: (game: Game, win: string) => void;
  playerLite: (game: Game, playerId: string) => { id: string };
  askHunterTarget: (
    game: Game,
    hunterId: string,
    alive: string[],
  ) => Promise<string | undefined>;
};

export function createVoteApi(ctx: OrchestratorContext, deps: VoteApiDependencies) {
  function beginVote(game: Game) {
    if (!canTransition(game, game.state, "VOTE")) return;
    const win = winner(game);
    if (win) {
      if (win === "WOLVES") enforceWolvesDomination(game);
      setState(game, "END");
      ctx.helpers.broadcastState(game);
      deps.emitGameEnded(game, win);
      return;
    }
    setState(game, "VOTE");
    game.votes = {};
    game.deadlines = {};
    game.revoteTargets = undefined;
    game.revoteRound = undefined;
    ctx.helpers.broadcastState(game);

    const alive = alivePlayers(game).map((pid) => deps.playerLite(game, pid));
    ctx.io.to("room:" + game.id).emit("vote:options", { alive });
    ctx.log(game.id, game.state, undefined, "vote.begin", { alive: alive.length });
  }

  function voteCast(gameId: string, playerId: string, targetId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "VOTE") throw new Error("bad_state");
    if (!game.alive.has(playerId)) throw new Error("dead_cannot_vote");
    if (!game.alive.has(targetId)) throw new Error("invalid_target");
    if (game.revoteTargets && !game.revoteTargets.includes(targetId)) {
      throw new Error("invalid_target");
    }
    const lover = game.players.find((p) => p.id === playerId)?.loverId;
    if (lover && lover === targetId) throw new Error("cannot_target_lover");
    game.votes[playerId] = targetId;
    ctx.log(game.id, game.state, playerId, "vote.cast", { targetId });

    const aliveIds = alivePlayers(game);
    try {
      const pending = aliveIds.filter((pid) => !(pid in game.votes));
      ctx.io.to("room:" + game.id).emit("vote:status", {
        voted: aliveIds.length - pending.length,
        total: aliveIds.length,
        pending: pending.map((pid) => deps.playerLite(game, pid)),
      });
    } catch {}
    const allVoted = aliveIds.every((pid) => pid in game.votes);
    if (allVoted) void endVote(game.id);
  }

  function voteCancel(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "VOTE") throw new Error("bad_state");
    delete game.votes[playerId];
    ctx.log(game.id, game.state, playerId, "vote.cancel");
    const aliveIds = alivePlayers(game);
    const pending = aliveIds.filter((pid) => !(pid in game.votes));
    ctx.io.to("room:" + game.id).emit("vote:status", {
      voted: aliveIds.length - pending.length,
      total: aliveIds.length,
      pending: pending.map((pid) => deps.playerLite(game, pid)),
    });
  }

  async function endVote(gameId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "VOTE") return;
    const { eliminated, tally } = computeVoteResult(game);
    const max = Math.max(0, ...Object.values(tally));
    const tied = Object.entries(tally)
      .filter(([, value]) => value === max)
      .map(([pid]) => pid);
    const tie = !eliminated && tied.length > 1;
    if (tie) {
      if (!game.revoteRound) {
        ctx.io.to("room:" + game.id).emit("vote:results", {
          eliminatedId: null,
          role: null,
          tally,
        });
        ctx.log(game.id, "VOTE", undefined, "vote.results", {
          eliminated: null,
          tie: true,
        });
        game.revoteTargets = tied;
        game.revoteRound = 1;
        setTimeout(() => {
          game.votes = {};
          game.deadlines = {};
          const alive = tied.map((pid) => deps.playerLite(game, pid));
          ctx.io.to("room:" + game.id).emit("vote:options", { alive });
          ctx.log(game.id, "VOTE", undefined, "vote.revote", { alive: alive.length });
          ctx.helpers.broadcastState(game);
        }, 3000);
        return;
      }
      game.revoteTargets = undefined;
      game.revoteRound = undefined;
      ctx.io.to("room:" + game.id).emit("vote:results", {
        eliminatedId: null,
        role: null,
        tally,
      });
      ctx.log(game.id, "VOTE", undefined, "vote.results", {
        eliminated: null,
        tie: true,
      });
      setState(game, "RESOLVE");
      try {
        const votes = Object.entries(game.votes).map(([voterId, target]) => ({
          voterId,
          targetId: target ?? null,
        }));
        ctx.io.to("room:" + game.id).emit("day:recap", { kind: "DAY", eliminated: [], votes });
        ctx.log(game.id, "RESOLVE", undefined, "day.recap", {
          deaths: 0,
          votes: votes.length,
        });
      } catch {}
      game.dayAcks = new Set<string>();
      deps.pendingDayAcks.add(game.id);
      ctx.helpers.broadcastState(game);
      return;
    }

    game.revoteTargets = undefined;
    game.revoteRound = undefined;
    setState(game, "RESOLVE");
    if (eliminated) {
      onPlayerDeath(game, eliminated, "VOTE");
      for (const vid of game.deferredGrief ?? []) {
        const lover = game.players.find((p) => p.id === vid)?.loverId;
        if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, "GRIEF");
      }
      game.deferredGrief = [];
      await resolveDeaths(game, (hunterId, aliveIds) => deps.askHunterTarget(game, hunterId, aliveIds));
    }

    ctx.io.to("room:" + game.id).emit("vote:results", {
      eliminatedId: eliminated ?? null,
      role: eliminated ? game.roles[eliminated] : null,
      tally,
    });
    ctx.log(game.id, "RESOLVE", undefined, "vote.results", {
      eliminated: eliminated ?? null,
    });
    try {
      const votes = Object.entries(game.votes).map(([voterId, target]) => ({
        voterId,
        targetId: target ?? null,
      }));
      const eliminatedArr = eliminated ? [eliminated] : [];
      ctx.io.to("room:" + game.id).emit("day:recap", { kind: "DAY", eliminated: eliminatedArr, votes });
      ctx.log(game.id, "RESOLVE", undefined, "day.recap", {
        deaths: eliminatedArr.length,
        votes: votes.length,
      });
    } catch {}
    game.dayAcks = new Set<string>();
    deps.pendingDayAcks.add(game.id);
    if (eliminated) deps.pendingDayElimAck.set(game.id, eliminated);
    ctx.helpers.broadcastState(game);
  }

  function voteAck(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);
    if (game.state !== "RESOLVE") return;
    const pending = deps.pendingDayElimAck.get(game.id);
    if (!pending || pending !== playerId) return;
    deps.pendingDayElimAck.delete(game.id);
    beginCheckEnd(game);
  }

  function beginCheckEnd(game: Game) {
    setState(game, "CHECK_END");
    const win = winner(game);
    if (win) {
      if (win === "WOLVES") enforceWolvesDomination(game);
      setState(game, "END");
      ctx.helpers.broadcastState(game);
      deps.emitGameEnded(game, win);
    } else {
      ctx.helpers.globalSleep(game, () => ctx.helpers.beginNightSeer(game));
    }
  }

  return {
    beginVote,
    voteCast,
    voteCancel,
    endVote,
    voteAck,
    beginCheckEnd,
  };
}



