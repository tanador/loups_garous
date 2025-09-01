import { Game, GameState } from './types.js';

export function canTransition(_game: Game, from: GameState, to: GameState): boolean {
  const order: GameState[] = [
    'LOBBY','ROLES','NIGHT_WOLVES','NIGHT_WITCH','MORNING','VOTE','RESOLVE','CHECK_END','END'
  ];
  // allow loops from CHECK_END -> NIGHT_WOLVES
  if (from === 'CHECK_END' && to === 'NIGHT_WOLVES') return true;
  return order.indexOf(to) === order.indexOf(from) + 1;
}

export function setState(game: Game, to: GameState): void {
  game.state = to;
  game.updatedAt = Date.now();
}
