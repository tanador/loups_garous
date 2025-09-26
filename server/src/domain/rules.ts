/**
 * Core business rules for the Werewolf (Loup Garou) game.
 *
 * Quick refresher for absolute beginners:
 *   - Nights are secret: special roles act in a precise order while villagers
 *     keep their eyes closed. Wolves agree on a victim, the Seer can peek at
 *     a role, the Witch may heal or poison, the Hunter prepares a last shot.
 *   - Days are public: everyone learns who died during the night, debates, and
 *     the village votes to eliminate a suspect. The executed player leaves the
 *     game immediately.
 *   - Win conditions: villagers win when every wolf is dead; wolves win when
 *     they are the only camp left. Lovers can form a neutral team that tries to
 *     survive together whatever their original camp (official rule).
 *
 * Everything below mutates the `Game` structure or computes derived data so the
 * orchestrator can drive Socket.IO events without duplicating board-game logic.
 */
import { randomInt } from 'crypto';
import { Game, Role, PendingDeath } from './types.js';
import { ROLE_SETUPS } from './roles/index.js';
import { secureShuffle } from './utils.js';
import { bus, HunterShot } from './events.js';

/**
 * Assign a secret role to every connected player.
 *
 * We mirror the official deck building rules from the board game: start from
 * the JSON configuration, shuffle securely, and if the Thief is in the deck we
 * keep two face-down cards in the center so the Thief can swap during
 * NIGHT_THIEF.
 */
export function assignRoles(
  game: Game,
  // Parameter kept for future deterministic shuffles in tests (unused for now).
  _rng: (max: number) => number = randomInt,
): void {
  const players = secureShuffle(game.players.map((p) => p.id));
  const cfg = ROLE_SETUPS[game.maxPlayers];
  if (!cfg) throw new Error('no_config_for_player_count');

  // Build deck from exact counts per role (e.g., { WOLF:1, SEER:1, ... })
  const deck: Role[] = [];
  for (const [role, count] of Object.entries(cfg) as [Role, number][]) {
    for (let i = 0; i < count; i++) deck.push(role);
  }
  // If THIEF is present in the deck at least once, add 2 extra villagers to the deck
  // (official rule). These are NOT dealt to players; they form the center.
  const thiefInDeck = deck.includes('THIEF' as Role);
  const deckPlus: Role[] = deck.slice();
  if (thiefInDeck) {
    deckPlus.push('VILLAGER' as Role, 'VILLAGER' as Role);
  }
  // Validate deck size: must be N + (2 if thief present else 0)
  const expected = game.maxPlayers + (thiefInDeck ? 2 : 0);
  if (deckPlus.length !== expected) {
    throw new Error(`invalid_deck_size: got=${deckPlus.length} expected=${expected}`);
  }

  // Shuffle the full deck (players + maybe 2 center cards)
  const shuffled = secureShuffle(deckPlus);
  let hand = shuffled.slice(0, game.maxPlayers);
  let center = shuffled.slice(game.maxPlayers);
  // Guarantee: if THIEF is part of the deck, ensure a player actually has THIEF.
  // Shuffle can otherwise leave THIEF among the 2 center cards. If that happens,
  // swap THIEF from center into the hand (replace the last card of the hand).
  if (thiefInDeck && !hand.includes('THIEF' as Role)) {
    const idxCenter = center.findIndex((r) => r === ('THIEF' as Role));
    if (idxCenter >= 0) {
      const lastIdx = hand.length - 1;
      const tmp = hand[lastIdx];
      hand[lastIdx] = center[idxCenter];
      center[idxCenter] = tmp;
    }
  }
  game.centerCards = center; // [] or [Role, Role]
  const assigned: Record<string, Role> = {};
  players.forEach((pid, idx) => (assigned[pid] = hand[idx]));
  game.roles = assigned;
  // Mirror assigned roles into Player objects for convenience
  game.players.forEach((p) => (p.role = assigned[p.id]));
}
// List every player whose secret role is WOLF (dead or alive).
export function wolvesOf(game: Game): string[] {
  return game.players.filter(p => game.roles[p.id] === 'WOLF').map(p => p.id);
}

// Wolves that are alive and currently connected (able to vote at night).
export function activeWolves(game: Game): string[] {
  return game.players
    .filter(
      (p) => game.roles[p.id] === 'WOLF' && game.alive.has(p.id) && p.connected,
    )
    .map((p) => p.id);
}

// Helper to find the Witch player id if the role is present.
export function witchId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'WITCH')?.id;
}

// Helper to find Cupid's player id when the role exists in this match.
export function cupidId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'CUPID')?.id;
}

// Nicknames for every player who has not been eliminated yet.
export function alivePlayers(game: Game): string[] {
  return game.players.filter(p => game.alive.has(p.id)).map(p => p.id);
}

// Alive players that are not wolves (potential night victims).
export function nonWolvesAlive(game: Game): string[] {
  return alivePlayers(game).filter(pid => game.roles[pid] !== 'WOLF');
}

/**
 * Compute the list of players who should die during the current night.
 *
 * Each role publishes its action on the domain event bus (wolves, witch, guard, etc.).
 * We aggregate their effects here and let the orchestrator apply the result in the morning.
 */
export async function computeNightDeaths(game: Game): Promise<string[]> {
  const deaths = new Set<string>();
  // Let each role publish its night action on the domain event bus.
  await bus.emit('NightAction', { game, deaths });
  return Array.from(deaths);
}

/**
 * Resolve cascading deaths (hunter revenge, lover grief, chained poison).
 *
 * The function consumes a queue of `PendingDeath` objects so we can fairly apply
 * deaths in the same order as the board game. When the Hunter dies we pause to
 * ask the client for a target, then enqueue the result.
 */
export async function applyDeaths(
  game: Game,
  initialDeaths: string[],
  askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined,
  opts?: { deferGrief?: boolean }
): Promise<{ deaths: string[]; hunterShots: HunterShot[] }> {
  const queue: PendingDeath[] = initialDeaths.map((v) => ({ victimId: v, cause: 'CHAIN' }));
  return await processDeathQueue(game, queue, askHunter, opts);
}

// Centralized enqueue API to branch on every validated death.
export function onPlayerDeath(game: Game, victimId: string, cause: string): void {
  if (!game.pendingDeaths) game.pendingDeaths = [];
  game.pendingDeaths.push({ victimId, cause });
}

// Resolve all pending deaths enqueued via onPlayerDeath
export async function resolveDeaths(
  game: Game,
  askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined,
  opts?: { deferGrief?: boolean }
): Promise<{ deaths: string[]; hunterShots: HunterShot[] }> {
  const queue = game.pendingDeaths ?? [];
  game.pendingDeaths = [];
  return await processDeathQueue(game, queue, askHunter, opts);
}

async function processDeathQueue(
  game: Game,
  queue: PendingDeath[],
  askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined,
  opts?: { deferGrief?: boolean }
): Promise<{ deaths: string[]; hunterShots: HunterShot[] }> {
  const resolved: string[] = [];
  const hunterShots: HunterShot[] = [];
  while (queue.length > 0) {
    const ev = queue.shift()!;
    const victim = ev.victimId;
    if (!game.alive.has(victim)) continue;
    resolved.push(victim);
    game.alive.delete(victim);
    await bus.emit('ResolvePhase', { game, victim, queue, hunterShots, askHunter });
    // After death-specific effects, schedule lover grief at the end
    const p = game.players.find((x) => x.id === victim);
    const loverId = p?.loverId;
    if (loverId && game.alive.has(loverId)) {
      if (opts?.deferGrief) {
        if (!game.deferredGrief) game.deferredGrief = [];
        if (!game.deferredGrief.includes(victim)) game.deferredGrief.push(victim);
      } else {
        queue.push({ victimId: loverId, cause: 'GRIEF' });
      }
    }
  }
  return { deaths: resolved, hunterShots };
}

/**
 * Count daytime votes and return both the tally and the eliminated player.
 *
 * Ties are reported as `eliminated: null`. The orchestrator then schedules a
 * revote between the tied players, matching the official board game rules.
 */
export function computeVoteResult(game: Game): { eliminated: string | null; tally: Record<string, number> } {
  const tally: Record<string, number> = {};
  for (const pid of alivePlayers(game)) {
    const t = game.votes[pid];
    if (!t) continue;
    if (!game.alive.has(t)) continue;
    tally[t] = (tally[t] ?? 0) + 1;
  }
  const entries = Object.entries(tally);
  if (entries.length === 0) return { eliminated: null, tally };

  entries.sort((a, b) => b[1] - a[1]);
  const [topId, topVotes] = entries[0];
  const tied = entries.filter(([, n]) => n === topVotes).length > 1;
  if (tied) return { eliminated: null, tally };
  return { eliminated: topId, tally };
}

/**
 * Evaluate victory conditions in priority order.
 *
 * 1. Mixed-camp lovers win as soon as they are the only survivors.
 * 2. Villagers win when no wolf remains.
 * 3. Wolves win once they are at least as numerous as the remaining players.
 */
export function winner(game: Game): 'WOLVES' | 'VILLAGE' | 'LOVERS' | null {
  const alive = alivePlayers(game);
  // Lovers mixed-camps victory: exactly the two lovers survive
  if (game.loversMode === 'MIXED_CAMPS' && alive.length === 2) {
    const [a, b] = alive;
    const pa = game.players.find((p) => p.id === a);
    const pb = game.players.find((p) => p.id === b);
    if (pa?.loverId === b && pb?.loverId === a) return 'LOVERS';
  }
  // Count wolves versus non-wolves to evaluate the remaining camps.
  const wolves = alive.filter(pid => game.roles[pid] === 'WOLF').length;
  const nonWolves = alive.length - wolves;

  // No wolves alive? The village eradicated the threat.
  if (wolves === 0) return 'VILLAGE';

  // Wolves win as soon as they match or exceed the remaining non-wolves.
  if (wolves >= nonWolves) return 'WOLVES';

  // Otherwise no win condition has been reached yet.
  return null;
}


/**
 * Remove any surviving non-wolves from the alive set so the final snapshot
 * reflects that the wolves wiped out the village when they reached parity.
 * Returns the identifiers that were removed.
 */
export function enforceWolvesDomination(game: Game): string[] {
  const removed: string[] = [];
  for (const pid of Array.from(game.alive.values())) {
    if (game.roles[pid] !== 'WOLF') {
      game.alive.delete(pid);
      removed.push(pid);
    }
  }
  return removed;
}
// Wolves may only target alive non-wolves.
export function targetsForWolves(game: Game): string[] {
  return nonWolvesAlive(game);
}

// The Witch cannot poison herself or her lover.
export function targetsForWitch(game: Game): string[] {
  const wid = witchId(game);
  const lover = game.players.find(p => p.id === wid)?.loverId;
  return alivePlayers(game).filter(pid => pid !== wid && pid !== lover);
}

/**
 * Record the Seer's vision and return the revealed role.
 *
 * The Seer is the investigator role: every night she selects a living player
 * and learns the hidden role. We keep a trace of that information in two places
 * so the client can build UX around it:
 *   - the Seer's private log (only she can read it)
 *   - the global game history (for recap screens or debugging).
 */
export function recordSeerPeek(game: Game, seerId: string, targetId: string): Role {
  const role = game.roles[targetId];
  if (!role) throw new Error('target_has_no_role');
  // Push the vision in the Seer's private log so only she can read it.
  const seer = game.players.find(p => p.id === seerId);
  if (!seer) throw new Error('seer_not_found');
  seer.privateLog.push({
    type: 'SEER_PEEK',
    targetId,
    role,
    night: game.round,
  });
  // Optional audit trail in game history
  let h = game.history.find((ev) => ev.round === game.round);
  if (!h) {
    h = { round: game.round, night: { deaths: [] }, events: [] };
    game.history.push(h);
  } else if (!h.events) {
    h.events = [];
  }
  // Store the vision inside the global history for recap screens.
  h.events!.push({ type: 'SEER_PEEK', seerId, targetId, role });
  return role;
}

// Check whether the Witch is allowed to heal the attacked player.
export function canBeSaved(game: Game, pid: string): boolean {
  return (
    game.night.attacked === pid &&
    game.night.saved !== pid &&
    !game.inventory.witch.healUsed
  );
}

/**
 * Check whether the wolves agreed on the same target.
 *
 * Only connected wolves are considered so an offline teammate does not block the phase.
 */
export function isConsensus(game: Game): { consensus: boolean; target?: string } {
  const wolves = activeWolves(game);
  if (wolves.length <= 1) {
    const t = wolves.length === 1 ? game.wolvesChoices[wolves[0]] : null;
    return t ? { consensus: true, target: t } : { consensus: false };
  }
  const choices = wolves.map((w) => game.wolvesChoices[w]).filter(Boolean) as string[];
  if (choices.length < wolves.length) return { consensus: false };
  const allSame = choices.every((c) => c === choices[0]);
  return allSame ? { consensus: true, target: choices[0] } : { consensus: false };
}




