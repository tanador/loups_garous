/**
 * Finite state machine for the Loup Garou day/night cycle.
 *
 * Each state mirrors a moment of the board game:
 *   - Lobby: players gather and mark themselves as ready.
 *   - Roles: cards are dealt, special roles may perform a "night zero" action
 *     (Thief swaps cards, Cupid links lovers).
 *   - Night phases: wolves attack, the Seer peeks, the Witch chooses whether to
 *     heal or poison, etc.
 *   - Morning / Vote / Resolve / Check end: the village discovers the night
 *     casualties, debates, votes, and we evaluate victory conditions.
 *
 * Keeping transitions explicit makes it easier for beginners to audit the flow
 * when a bug occurs: if the orchestrator tries to jump from VOTE straight to
 * NIGHT_WOLVES the guard below will throw.
 */
import { Game, GameState } from './types.js';

type TransitionMap = Record<string, GameState[]>;

const transitions: TransitionMap = {
  LOBBY: ['ROLES', 'END'],
  ROLES: ['NIGHT_THIEF', 'NIGHT_CUPID', 'NIGHT_SEER', 'NIGHT_WOLVES', 'END'],
  NIGHT_THIEF: ['NIGHT_CUPID', 'NIGHT_SEER', 'END'],
  NIGHT_CUPID: ['NIGHT_LOVERS', 'NIGHT_SEER', 'NIGHT_WOLVES', 'END'],
  NIGHT_LOVERS: ['NIGHT_SEER', 'NIGHT_WOLVES', 'END'],
  NIGHT_SEER: ['NIGHT_WOLVES', 'END'],
  NIGHT_WOLVES: ['NIGHT_WITCH', 'END'],
  NIGHT_WITCH: ['MORNING', 'END'],
  MORNING: ['VOTE', 'END'],
  VOTE: ['RESOLVE', 'END'],
  RESOLVE: ['CHECK_END', 'END'],
  CHECK_END: ['END', 'NIGHT_SEER', 'NIGHT_WOLVES'],
  END: [],
};

/**
 * Allow role modules to extend the FSM with optional phases. Rare but useful if
 * we introduce new roles (e.g. Guard) that need their own dedicated step.
 */
export function registerTransitions(map: TransitionMap): void {
  for (const [from, targets] of Object.entries(map)) {
    if (!transitions[from]) transitions[from] = [];
    for (const to of targets) {
      if (!transitions[from].includes(to)) transitions[from].push(to);
    }
  }
}

/**
 * Guard used by the orchestrator before every state change.
 */
export function canTransition(_game: Game, from: GameState, to: GameState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

/**
 * Apply a state change after validating the transition.
 *
 * We also update the `updatedAt` timestamp so monitoring tools or tests can
 * assert that something actually happened.
 */
export function setState(game: Game, to: GameState): void {
  if (!canTransition(game, game.state, to)) {
    throw new Error(`invalid_transition:${game.state}->${to}`);
  }
  game.state = to;
  game.updatedAt = Date.now();
}

// Useful for documentation or debugging tools that want to visualise the graph.
export function getTransitions(): TransitionMap {
  return transitions;
}
