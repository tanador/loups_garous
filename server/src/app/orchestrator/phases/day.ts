import type { Game } from "../../../domain/types.js";
import { canTransition, setState } from "../../../domain/fsm.js";
import {
  alivePlayers,
  computeNightDeaths,
  onPlayerDeath,
  resolveDeaths,
  winner,
} from "../../../domain/rules.js";
import { DURATION } from "../../timers.js";
import type { OrchestratorContext } from "../context.js";
import {
  ack,
  beginAck,
  cancelTimer,
  mustGet,
  scheduleTimer,
  setDeadline,
} from "../utils.js";

const TIMER = (gameId: string, step: string) => gameId + ":day:" + step;
const ACK_MORNING = (gameId: string) => gameId + ":day:morning";

export type DayApiDependencies = {
  pendingHunters: Map<string, string[]>;
  morningRecaps: Map<string, { deaths: { playerId: string; role: string }[]; hunterKills: string[] }>;
  askHunterTarget: (
    game: Game,
    hunterId: string,
    alive: string[],
  ) => Promise<string | undefined>;
  pendingDayAcks: Set<string>;
  livingAckProgress: (game: Game, ackSet: Set<string>) => { acked: number; needed: number };
  emitGameEnded: (game: Game, win: string) => void;
  beginVote: (game: Game) => void;
  beginCheckEnd: (game: Game) => void;
};

export function createDayApi(ctx: OrchestratorContext, deps: DayApiDependencies) {`r`n  async function beginMorning(game: Game) {`r`n    if (!canTransition(game, game.state, "MORNING")) return;`r`n    game.hunterPending = false;

    const initial = await computeNightDeaths(game);
    for (const victim of initial) onPlayerDeath(game, victim, "NIGHT");
    const { deaths } = await resolveDeaths(game, undefined, { deferGrief: true });

    let allDeaths = [...deaths];
    let hunters = deaths.filter((pid) => game.roles[pid] === "HUNTER");

    if (hunters.length === 0 && (game.deferredGrief?.length ?? 0) > 0) {
      for (const vid of game.deferredGrief ?? []) {
        const lover = game.players.find((p) => p.id === vid)?.loverId;
        if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, "GRIEF");
      }
      game.deferredGrief = [];
      const grief = await resolveDeaths(game, undefined, { deferGrief: false });
      allDeaths.push(...grief.deaths);
      const griefHunters = grief.deaths.filter((pid) => game.roles[pid] === "HUNTER");
      if (griefHunters.length > 0) hunters = hunters.concat(griefHunters);
    }

    if (hunters.length > 0) deps.pendingHunters.set(game.id, hunters);

    const recap = {
      deaths: allDeaths.map((pid) => ({ playerId: pid, role: game.roles[pid] })),
      hunterKills: [] as string[],
    };
    deps.morningRecaps.set(game.id, recap);

    for (const player of game.players) ctx.helpers.sendSnapshot(game, player.id);
    ctx.io.to('room:' + game.id).emit("day:recap", recap);
    ctx.log(game.id, game.state, undefined, "day.recap", {
      deaths: deaths.length,
      hunterKills: 0,
    });

    setState(game, "MORNING");
    ctx.helpers.broadcastState(game);

    const pending = deps.pendingHunters.get(game.id) ?? [];
    const win = pending.length > 0 ? null : winner(game);
    if (win) {
      setState(game, "END");
      ctx.helpers.broadcastState(game);
      deps.emitGameEnded(game, win);
      return;
    }

    game.morningAcks.clear();
    setDeadline(ctx, game, DURATION.MORNING_MS);
    ctx.helpers.broadcastState(game);

    scheduleTimer(ctx, TIMER(game.id, "morning"), DURATION.MORNING_MS, () => {
      void handleMorningEnd(game);
    });
  }

  function dayAck(gameId: string, playerId: string) {
    const game = mustGet(ctx, gameId);

    if (game.state === "MORNING") {
      if (!game.alive.has(playerId)) {
        ctx.log(game.id, game.state, playerId, "day.ack.ignored_dead");
        return;
      }
      game.morningAcks.add(playerId);
      ctx.log(game.id, game.state, playerId, "day.ack");
      const key = ACK_MORNING(game.id);
      if (!ctx.waitlists.acks.has(key)) {
        const expected = new Set(Array.from(game.alive.values()));
        beginAck(ctx, key, expected);
      }
      const done = ack(ctx, key, playerId);
      const { acked, needed } = deps.livingAckProgress(game, game.morningAcks);
      if (needed === 0 || acked >= needed || done) {
        cancelTimer(ctx, TIMER(game.id, "morning"));
        ctx.waitlists.acks.delete(key);
        void handleMorningEnd(game);
      }
      return;
    }

    if (game.state === "RESOLVE") {
      if (!deps.pendingDayAcks.has(game.id)) deps.pendingDayAcks.add(game.id);
      if (!game.dayAcks) game.dayAcks = new Set<string>();
      if (!game.alive.has(playerId)) {
        ctx.log(game.id, game.state, playerId, "day.ack.ignored_dead");
        return;
      }
      game.dayAcks.add(playerId);
      ctx.log(game.id, game.state, playerId, "day.ack");
      const { acked, needed } = deps.livingAckProgress(game, game.dayAcks);
      if (needed === 0 || acked >= needed) {
        deps.pendingDayAcks.delete(game.id);
        deps.beginCheckEnd(game);
      }
      return;
    }

    try {
      ctx.log(game.id, game.state, playerId, "day.ack.unexpected", {
        pendingDayAcks: deps.pendingDayAcks.has(game.id),
        morning: game.morningAcks?.size ?? 0,
        dayAcks: (game as any).dayAcks ? (game as any).dayAcks.size : 0,
      });
    } catch {}
    throw new Error("bad_state");
  }

  async function handleMorningEnd(game: Game) {
    if (game.state !== "MORNING") return;

    ctx.waitlists.acks.delete(ACK_MORNING(game.id));

    const pending = deps.pendingHunters.get(game.id) ?? [];
    const recap = deps.morningRecaps.get(game.id);

    if (pending.length > 0 && recap) {
      for (const hid of pending) {
        const alive = alivePlayers(game);
        const loverId = game.players.find((p) => p.id === hid)?.loverId;
        const options = alive.filter((pid) => pid !== hid && pid !== loverId);

        let target: string | undefined;
        if (options.length === 0) {
          ctx.log(game.id, "MORNING", hid, "hunter.skip_no_targets", {
            alive: alive.length,
          });
        } else {
          target = await deps.askHunterTarget(game, hid, alive);
        }

        if (target && game.alive.has(target)) {
          onPlayerDeath(game, target, "HUNTER");
        }

        const hadDeferredGrief = (game.deferredGrief?.length ?? 0) > 0;
        if (hadDeferredGrief) {
          for (const vid of game.deferredGrief ?? []) {
            const lover = game.players.find((p) => p.id === vid)?.loverId;
            if (lover && game.alive.has(lover)) onPlayerDeath(game, lover, "GRIEF");
          }
          game.deferredGrief = [];
        }

        const hasPendingDeaths = (game.pendingDeaths?.length ?? 0) > 0;
        if ((target && game.alive.has(target)) || hadDeferredGrief || hasPendingDeaths) {
          const { deaths, hunterShots } = await resolveDeaths(
            game,
            (hunterId, aliveIds) => deps.askHunterTarget(game, hunterId, aliveIds),
          );
          if (deaths.length > 0) {
            recap.deaths.push(
              ...deaths.map((pid) => ({ playerId: pid, role: game.roles[pid] })),
            );
          }
          const kills: string[] = [];
          if (target) kills.push(target);
          if (hunterShots.length > 0) kills.push(...hunterShots.map((shot) => shot.targetId));
          if (kills.length > 0) recap.hunterKills.push(...kills);
        }
      }

      deps.pendingHunters.delete(game.id);
      deps.morningRecaps.set(game.id, recap);

      for (const player of game.players) ctx.helpers.sendSnapshot(game, player.id);
      ctx.io.to('room:' + game.id).emit("day:recap", recap);
      ctx.log(game.id, "MORNING", undefined, "day.recap", {
        deaths: recap.deaths.length,
        hunterKills: recap.hunterKills.length,
      });

      game.morningAcks.clear();
      setDeadline(ctx, game, DURATION.MORNING_MS);
      ctx.helpers.broadcastState(game);
      scheduleTimer(ctx, TIMER(game.id, "morning"), DURATION.MORNING_MS, () => {
        void handleMorningEnd(game);
      });
      return;
    }

    const recapHadShots = Boolean(recap && recap.hunterKills.length > 0);

    if (recapHadShots) {
      deps.beginVote(game);
      return;
    }

    const win = winner(game);
    if (win) {
      setState(game, "END");
      ctx.helpers.broadcastState(game);
      deps.emitGameEnded(game, win);
      return;
    }

    deps.beginVote(game);
  }

  return {
    beginMorning,
    dayAck,
    handleMorningEnd,
  };
}
