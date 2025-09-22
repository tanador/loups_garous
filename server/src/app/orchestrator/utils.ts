import type { Socket } from "socket.io";
import type { Game } from "../../domain/types.js";
import type { OrchestratorContext, AckWaitlist } from "./context.js";

export function mustGet(ctx: OrchestratorContext, gameId: string): Game {
  const game = ctx.store.get(gameId);
  if (!game) throw new Error("game_not_found");
  return game;
}

export function setDeadline(_ctx: OrchestratorContext, game: Game, ms: number) {
  game.deadlines = { phaseEndsAt: Date.now() + ms };
}

export function scheduleTimer(
  ctx: OrchestratorContext,
  gameId: string,
  ms: number,
  cb: () => void,
) {
  const previous = ctx.timers.get(gameId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(cb, ms);
  ctx.timers.set(gameId, timer);
}

export function cancelTimer(ctx: OrchestratorContext, gameId: string) {
  const previous = ctx.timers.get(gameId);
  if (!previous) return;
  clearTimeout(previous);
  ctx.timers.delete(gameId);
}

export function limit(
  _ctx: OrchestratorContext,
  counters: Map<string, { n: number; resetAt: number }>,
  socket: Socket,
  key: string,
  max = 10,
  windowMs = 5000,
): boolean {
  const compositeKey = socket.id + ":" + key;
  const nowMs = Date.now();
  const current = counters.get(compositeKey);
  if (!current || current.resetAt < nowMs) {
    counters.set(compositeKey, { n: 1, resetAt: nowMs + windowMs });
    return true;
  }
  if (current.n >= max) return false;
  current.n += 1;
  return true;
}

export function beginAck(
  ctx: OrchestratorContext,
  key: string,
  expected: Set<string>,
) {
  const clean = new Set(Array.from(expected.values()));
  const state: AckWaitlist = { expected: clean, acknowledged: new Set() };
  ctx.waitlists.acks.set(key, state);
}

export function ack(ctx: OrchestratorContext, key: string, playerId: string): boolean {
  const state = ctx.waitlists.acks.get(key);
  if (!state || !state.expected.has(playerId)) return false;
  state.acknowledged.add(playerId);
  return state.acknowledged.size >= state.expected.size;
}

export function allAcked(ctx: OrchestratorContext, key: string): boolean {
  const state = ctx.waitlists.acks.get(key);
  if (!state) return false;
  return state.expected.size === 0 || state.acknowledged.size >= state.expected.size;
}

export function livingAckProgress(game: Game, ackSet: Set<string>): {
  acked: number;
  needed: number;
} {
  for (const pid of Array.from(ackSet)) {
    if (!game.alive.has(pid)) ackSet.delete(pid);
  }
  let acked = 0;
  for (const pid of game.alive.values()) {
    if (ackSet.has(pid)) acked += 1;
  }
  return { acked, needed: game.alive.size };
}
