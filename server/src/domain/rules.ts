import { randomInt } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game, Role } from './types.js';
import { secureShuffle } from './utils.js';

type RoleConfig = Record<Role, { min: number; max: number }>;
type RolesConfig = Record<number, RoleConfig>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../../roles.config.json');
const CONFIG: RolesConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

export function assignRoles(game: Game, rng: (max: number) => number = randomInt): void {
  const players = secureShuffle(game.players.map(p => p.id));
  const cfg = CONFIG[game.maxPlayers];
  if (!cfg) throw new Error('no_config_for_player_count');

  const roleNames = Object.keys(cfg) as Role[];
  roleNames.sort();

  // enumerate all valid role distributions
  const distributions: Record<Role, number>[] = [];
  const total = game.maxPlayers;

  function backtrack(
    idx: number,
    remaining: number,
    current: Partial<Record<Role, number>>
  ) {
    if (idx === roleNames.length) {
      if (remaining === 0)
        distributions.push({ ...current } as Record<Role, number>);
      return;
    }
    const role = roleNames[idx];
    const { min, max } = cfg[role];
    for (let c = min; c <= max; c++) {
      if (c > remaining) break;
      current[role] = c;
      backtrack(idx + 1, remaining - c, current);
      delete current[role];
    }
  }

  backtrack(0, total, {});
  if (distributions.length === 0) throw new Error('invalid_role_config');

  const counts = distributions[rng(distributions.length)];

  const roles: Role[] = [];
  for (const r of roleNames) {
    roles.push(...Array(counts[r]).fill(r));
  }

  const shuffledRoles = secureShuffle(roles);
  const assigned: Record<string, Role> = {};
  players.forEach((pid, idx) => (assigned[pid] = shuffledRoles[idx]));
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

export async function applyDeaths(
  game: Game,
  initialDeaths: string[],
  askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined
): Promise<string[]> {
  const queue = [...initialDeaths];
  const resolved: string[] = [];
  while (queue.length > 0) {
    const victim = queue.shift()!;
    if (!game.alive.has(victim)) continue;
    resolved.push(victim);
    game.alive.delete(victim);
    if (game.roles[victim] === 'HUNTER' && askHunter) {
      const alive = alivePlayers(game).filter(pid => pid !== victim);
      const wolves = alive.filter(pid => game.roles[pid] === 'WOLF');
      const nonWolves = alive.length - wolves.length;

      // si seuls des loups restent en vie et qu'il y en a plus d'un,
      // le tir du chasseur ne peut pas changer l'issue de la partie
      if (!(nonWolves === 0 && wolves.length > 1)) {
        const target = await Promise.resolve(askHunter(victim, alive));
        if (target && game.alive.has(target)) queue.push(target);
      }
    }
  }
  return resolved;
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
