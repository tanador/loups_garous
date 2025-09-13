import { randomInt } from 'crypto';
import { Game, Role, PendingDeath } from './types.js';
import { ROLE_SETUPS } from './roles/index.js';
import { secureShuffle } from './utils.js';
import { bus, HunterShot } from './events.js';

// Ensemble des règles métier: attribution des rôles, résolutions des votes, etc.
/// Attribue aléatoirement les rôles aux joueurs selon la configuration.
/// La fonction génère toutes les distributions possibles respectant les
/// contraintes min/max puis en choisit une au hasard.
/**
 * Deal roles to players from a real deck described by roles.config.json.
 *
 * Deck model (Option 1 with THIEF):
 * - The JSON setups now define exact counts per role for N players.
 * - If the deck contains at least one THIEF card, we append 2 VILLAGER cards
 *   to the deck. These two extra cards become the face-down center cards used
 *   by the THIEF during NIGHT_THIEF (Nuit 0).
 * - We then shuffle the deck, deal 1 card per player, and keep the remaining
 *   (0 or 2) as game.centerCards.
 * - Public snapshots never expose centerCards; only the THIEF receives them
 *   privately in `thief:wake`.
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
/// Retourne la liste des loups encore en jeu.
export function wolvesOf(game: Game): string[] {
  return game.players.filter(p => game.roles[p.id] === 'WOLF').map(p => p.id);
}

/// Liste les loups vivants et connectés.
export function activeWolves(game: Game): string[] {
  return game.players
    .filter(
      (p) => game.roles[p.id] === 'WOLF' && game.alive.has(p.id) && p.connected,
    )
    .map((p) => p.id);
}

/// Identifiant de la sorcière, s'il y en a une.
export function witchId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'WITCH')?.id;
}

/// Identifiant de Cupidon, s'il y en a un.
export function cupidId(game: Game): string | undefined {
  return game.players.find(p => game.roles[p.id] === 'CUPID')?.id;
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
export function winner(game: Game): 'WOLVES' | 'VILLAGE' | 'LOVERS' | null {
  const alive = alivePlayers(game);
  // Lovers mixed-camps victory: exactly the two lovers survive
  if (game.loversMode === 'MIXED_CAMPS' && alive.length === 2) {
    const [a, b] = alive;
    const pa = game.players.find((p) => p.id === a);
    const pb = game.players.find((p) => p.id === b);
    if (pa?.loverId === b && pb?.loverId === a) return 'LOVERS';
  }
  // Compter séparément les loups et les non‑loups encore en vie.
  // Cela permet d'appliquer clairement les conditions de victoire.
  const wolves = alive.filter(pid => game.roles[pid] === 'WOLF').length;
  const nonWolves = alive.length - wolves;

  // Aucun loup en vie ⇒ les villageois ont éradiqué la menace.
  if (wolves === 0) return 'VILLAGE';

  // Les loups ne gagnent que lorsqu'il ne reste plus aucun villageois.
  // La simple parité (même nombre de loups et de non‑loups) ne suffit
  // pas à clore la partie : on continue jusqu'à éliminer le dernier
  // villageois.
  if (nonWolves === 0) return 'WOLVES';

  // Sinon, aucune condition de victoire n'est encore atteinte.
  return null;
}

/// Cibles possibles pour l'attaque des loups (uniquement les villageois vivants).
export function targetsForWolves(game: Game): string[] {
  return nonWolvesAlive(game);
}

/// Cibles possibles de la sorcière pour la potion de mort (tous sauf elle).
export function targetsForWitch(game: Game): string[] {
  const wid = witchId(game);
  const lover = game.players.find(p => p.id === wid)?.loverId;
  return alivePlayers(game).filter(pid => pid !== wid && pid !== lover);
}

/**
 * Consigne la vision de la voyante et renvoie le rôle révélé.
 *
 * Dans *Loup Garou*, la voyante est l'un des rares rôles disposant
 * d'une information "parfaite". Chaque nuit elle choisit un joueur
 * encore en vie et apprend immédiatement son rôle secret. L'objectif
 * principal est de guider les villageois pendant la phase de vote.
 *
 * Techniquement, on conserve une trace de cette vision à deux endroits :
 *  - dans le journal privé de la voyante (affiché côté client pour elle seule)
 *  - dans l'historique complet de la partie pour un éventuel audit ou
 *    un écran de récap final.
 */
export function recordSeerPeek(game: Game, seerId: string, targetId: string): Role {
  const role = game.roles[targetId];
  if (!role) throw new Error('target_has_no_role');
  // Ajoute l'information dans le journal individuel de la voyante.
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
  // Enrichit l'historique global de la partie pour consultation ultérieure.
  h.events!.push({ type: 'SEER_PEEK', seerId, targetId, role });
  return role;
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
/**
 * Retourne si les loups ont un consensus sur une cible.
 *
 * Pédagogie (débutant):
 * - Seuls les loups vivants ET connectés sont pris en compte.
 *   Cela évite d'attendre une confirmation d'un loup mort/déconnecté,
 *   ce qui pourrait bloquer la phase inutilement.
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

