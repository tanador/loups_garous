import { randomInt } from 'crypto';
import { Game, Role } from './types.js';
import { ROLE_SETUPS } from './roles/index.js';
import { secureShuffle } from './utils.js';
import { bus, HunterShot } from './events.js';

/// Attribue aléatoirement les rôles aux joueurs selon la configuration.
/// La fonction génère toutes les distributions possibles respectant les
/// contraintes min/max puis en choisit une au hasard.
export function assignRoles(game: Game, rng: (max: number) => number = randomInt): void {
  const players = secureShuffle(game.players.map(p => p.id));
  const cfg = ROLE_SETUPS[game.maxPlayers];
  if (!cfg) throw new Error('no_config_for_player_count');

  const roleNames = Object.keys(cfg) as Role[];
  roleNames.sort();

  // Énumère toutes les répartitions de rôles possibles respectant la configuration
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

  // Mélange la liste pour ne pas attribuer toujours les mêmes rôles aux mêmes joueurs
  const shuffledRoles = secureShuffle(roles);
  const assigned: Record<string, Role> = {};
  players.forEach((pid, idx) => (assigned[pid] = shuffledRoles[idx]));
  game.roles = assigned;
  game.players.forEach(p => (p.role = assigned[p.id]));
}
/// Retourne la liste des loups encore en jeu.
export function wolvesOf(game: Game): string[] {
  return game.players.filter(p => game.roles[p.id] === 'WOLF').map(p => p.id);
}

/// Identifiant de la sorcière, s'il y en a une.
export function witchId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'WITCH')?.id;
}

/// Liste les joueurs toujours en vie.
export function alivePlayers(game: Game): string[] {
  return game.players.filter(p => game.alive.has(p.id)).map(p => p.id);
}

/// Retourne les joueurs non loups encore en vie.
export function nonWolvesAlive(game: Game): string[] {
  return alivePlayers(game).filter(pid => game.roles[pid] !== 'WOLF');
}

/// Calcule les décès résultant des actions nocturnes (loups, sorcière).
export async function computeNightDeaths(game: Game): Promise<string[]> {
  const deaths = new Set<string>();
  // Délègue aux rôles via le bus d'événements
  // pour déterminer les victimes de la nuit
  await bus.emit('NightAction', { game, deaths });
  return Array.from(deaths);
}

/// Résout les morts en chaîne (chasseur qui tire, etc.).
/// La fonction itère sur une file de victimes et peut demander au chasseur
/// de choisir une cible supplémentaire.
export async function applyDeaths(
  game: Game,
  initialDeaths: string[],
  askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined
): Promise<{ deaths: string[]; hunterShots: HunterShot[] }> {
  const queue = [...initialDeaths];
  const resolved: string[] = [];
  const hunterShots: HunterShot[] = [];
  while (queue.length > 0) {
    const victim = queue.shift()!;
    if (!game.alive.has(victim)) continue;
    resolved.push(victim);
    game.alive.delete(victim);
    await bus.emit('ResolvePhase', { game, victim, queue, hunterShots, askHunter });
  }
  return { deaths: resolved, hunterShots };
}

/// Calcule le résultat du vote du village et les voix pour chaque cible.
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

/// Détermine le vainqueur si toutes les conditions sont réunies.
export function winner(game: Game): 'WOLVES' | 'VILLAGE' | null {
  const alive = alivePlayers(game);
  const wolves = alive.filter(pid => game.roles[pid] === 'WOLF').length;
  const nonWolves = alive.length - wolves;
  if (wolves === 0) return 'VILLAGE';
  if (nonWolves === 0) return 'WOLVES';
  return null;
}

/// Cibles possibles pour l'attaque des loups (uniquement les villageois vivants).
export function targetsForWolves(game: Game): string[] {
  return nonWolvesAlive(game);
}

/// Cibles possibles de la sorcière pour la potion de mort (tous sauf elle).
export function targetsForWitch(game: Game): string[] {
  const wid = witchId(game);
  return alivePlayers(game).filter(pid => pid !== wid);
}

/// Indique si un joueur peut être sauvé par la potion de vie.
export function canBeSaved(game: Game, pid: string): boolean {
  return (
    game.night.attacked === pid &&
    game.night.saved !== pid &&
    !game.inventory.witch.healUsed
  );
}

/// Vérifie si tous les loups ont choisi la même cible pour l'attaque nocturne.
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
