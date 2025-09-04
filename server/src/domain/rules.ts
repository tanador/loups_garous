import { randomInt } from 'crypto';
import { Game, Role } from './types.js';
import { secureShuffle } from './utils.js';

export function assignRoles(game: Game, rng: (max: number) => number = randomInt): void {
  const players = secureShuffle(game.players.map(p => p.id));
  let roles: Role[] = [];
  if (game.maxPlayers === 3) {
    roles = ['WITCH', 'WOLF', 'VILLAGER'];
  } else if (game.maxPlayers === 4) {
    const wolves = rng(2) + 1; // 1 or 2 wolves
    roles = ['WITCH', ...Array(wolves).fill('WOLF'), ...Array(4 - wolves - 1).fill('VILLAGER')];
  }

  const assigned: Record<string, Role> = {};
  players.forEach((pid, idx) => (assigned[pid] = roles[idx]));
  game.roles = assigned;
  game.players.forEach(p => (p.role = assigned[p.id]));
}

export function wolvesOf(game: Game): string[] {
  return game.players.filter(p => game.roles[p.id] === 'WOLF').map(p => p.id);
}

export function witchId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'WITCH')?.id;
}

export function alivePlayers(game: Game): string[] {
  return game.players.filter(p => game.alive.has(p.id)).map(p => p.id);
}

export function nonWolvesAlive(game: Game): string[] {
  return alivePlayers(game).filter(pid => game.roles[pid] !== 'WOLF');
}

export function computeNightDeaths(game: Game): string[] {
  const { attacked, saved, poisoned } = game.night;
  const deaths = new Set<string>();

  if (attacked && attacked !== saved) deaths.add(attacked);
  if (poisoned) deaths.add(poisoned);

  // si attaqué et empoisonné le même joueur et sauvé, la potion de mort l'emporte
  // (sauvetage n'annule pas une autre cause de mort)
  return Array.from(deaths);
}

export function applyDeaths(game: Game, deaths: string[]): void {
  deaths.forEach(pid => game.alive.delete(pid));
}

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

export function winner(game: Game): 'WOLVES' | 'VILLAGE' | null {
  const alive = alivePlayers(game);
  const wolves = alive.filter(pid => game.roles[pid] === 'WOLF').length;
  const nonWolves = alive.length - wolves;
  if (wolves === 0) return 'VILLAGE';
  if (nonWolves === 0) return 'WOLVES';
  return null;
}

export function targetsForWolves(game: Game): string[] {
  // les loups voient uniquement les non-loups vivants
  return nonWolvesAlive(game);
}

export function targetsForWitch(game: Game): string[] {
  // peut empoisonner n'importe qui encore en vie sauf elle-même
  const wid = witchId(game);
  return alivePlayers(game).filter(pid => pid !== wid);
}

export function canBeSaved(game: Game, pid: string): boolean {
  // un joueur peut être sauvé s'il est attaqué et que la potion de vie est encore disponible
  return (
    game.night.attacked === pid &&
    game.night.saved !== pid &&
    !game.inventory.witch.healUsed
  );
}

export function isConsensus(game: Game): { consensus: boolean; target?: string } {
  const wolves = wolvesOf(game);
  if (wolves.length <= 1) {
    const t = wolves.length === 1 ? game.wolvesChoices[wolves[0]] : null;
    return t ? { consensus: true, target: t } : { consensus: false };
  }
  const choices = wolves.map(w => game.wolvesChoices[w]).filter(Boolean) as string[];
  if (choices.length < wolves.length) return { consensus: false };
  const allSame = choices.every(c => c === choices[0]);
  return allSame ? { consensus: true, target: choices[0] } : { consensus: false };
}
