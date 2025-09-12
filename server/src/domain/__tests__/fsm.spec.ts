import { describe, it, expect } from 'vitest';
import { canTransition, setState } from '../../domain/fsm.js';
import type { Game } from '../../domain/types.js';

function makeGame(state: any = 'LOBBY'): Game {
  return {
    id: 'G', state, createdAt: Date.now(), updatedAt: Date.now(), round: 0, maxPlayers: 3,
    players: [], roles: {}, center: Array(2) as any, alive: new Set(), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
    votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null,
  } as any;
}

describe('FSM transitions', () => {
  it('rejects invalid transitions with a clear error', () => {
    const g = makeGame('LOBBY');
    expect(canTransition(g, 'LOBBY', 'NIGHT_WOLVES')).toBe(false);
    expect(() => setState(g, 'NIGHT_WOLVES' as any)).toThrowError('invalid_transition:LOBBY->NIGHT_WOLVES');
    // state should remain unchanged
    expect(g.state).toBe('LOBBY');
  });

  it('accepts valid transitions', () => {
    const g = makeGame('LOBBY');
    expect(canTransition(g, 'LOBBY', 'ROLES')).toBe(true);
    setState(g, 'ROLES' as any);
    expect(g.state).toBe('ROLES');
  });
});

