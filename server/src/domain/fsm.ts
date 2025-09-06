import { Game, GameState } from './types.js';

/**
 * Table de transitions autorisées entre les états du jeu.
 * Les clés correspondent à l'état courant et la liste des valeurs contient
 * les états atteignables à partir de celui-ci.
 */
const transitions: Record<string, GameState[]> = {
  LOBBY: ['ROLES', 'END'],
  ROLES: ['NIGHT_CUPID', 'NIGHT_WOLVES', 'END'],
  NIGHT_CUPID: ['NIGHT_WOLVES', 'END'],
  NIGHT_WOLVES: ['NIGHT_WITCH', 'END'],
  NIGHT_WITCH: ['MORNING', 'END'],
  MORNING: ['VOTE', 'END'],
  VOTE: ['RESOLVE', 'END'],
  RESOLVE: ['CHECK_END', 'END'],
  CHECK_END: ['END', 'NIGHT_WOLVES'],
  END: [],
};

/**
 * Permet d'enregistrer de nouvelles transitions ou de modifier celles
 * existantes. Utilisée par les modules de rôles ou de règles pour ajouter des
 * phases personnalisées.
 */
export function registerTransitions(map: Record<string, GameState[]>): void {
  for (const [from, tos] of Object.entries(map)) {
    if (!transitions[from]) transitions[from] = [];
    for (const to of tos) {
      if (!transitions[from].includes(to)) transitions[from].push(to);
    }
  }
}

/// Vérifie si un changement d'état est autorisé par la machine à états du jeu.
export function canTransition(_game: Game, from: GameState, to: GameState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

/**
 * Applique le nouvel état sur la partie après validation et met à jour le
 * timestamp.
 */
export function setState(game: Game, to: GameState): void {
  if (!canTransition(game, game.state, to)) {
    throw new Error(`invalid_transition:${game.state}->${to}`);
  }
  game.state = to;
  game.updatedAt = Date.now();
}

// Expose les transitions pour inspection ou tests éventuels.
export function getTransitions(): Record<string, GameState[]> {
  return transitions;
}

