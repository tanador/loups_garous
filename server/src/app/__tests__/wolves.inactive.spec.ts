import { describe, it, expect } from 'vitest';
import { isConsensus } from '../../domain/rules.js';
import type { Game, Player } from '../../domain/types.js';

const mkPlayer = (id: string, connected = true): Player => ({
  id,
  socketId: 's:' + id,
  isReady: true,
  connected,
  lastSeen: Date.now(),
} as any);

describe('isConsensus with inactive wolves', () => {
  it('ignores disconnected wolf', () => {
    const w1 = mkPlayer('W1');
    const w2 = mkPlayer('W2', false);
    const v = mkPlayer('V');
    const game: Game = {
      id: 'G', state: 'NIGHT_WOLVES', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 3,
      players: [w1, w2, v], roles: { W1: 'WOLF', W2: 'WOLF', V: 'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['W1', 'W2', 'V']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: { W1: 'V' }, morningAcks: new Set(), loversMode: null,
    } as any;
    const { consensus, target } = isConsensus(game);
    expect(consensus).toBe(true);
    expect(target).toBe('V');
  });

  it('ignores dead wolf', () => {
    const w1 = mkPlayer('W1');
    const w2 = mkPlayer('W2');
    const v = mkPlayer('V');
    const game: Game = {
      id: 'G', state: 'NIGHT_WOLVES', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 3,
      players: [w1, w2, v], roles: { W1: 'WOLF', W2: 'WOLF', V: 'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['W1', 'V']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: { W1: 'V' }, morningAcks: new Set(), loversMode: null,
    } as any;
    const { consensus, target } = isConsensus(game);
    expect(consensus).toBe(true);
    expect(target).toBe('V');
  });
});
