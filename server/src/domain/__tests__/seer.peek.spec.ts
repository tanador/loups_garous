import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { recordSeerPeek } from '../rules.js';

// Ensure seer peeks are logged for auditing

describe('recordSeerPeek', () => {
  it('records peek in player private log and history', () => {
    const g = createGame(3);
    g.round = 1;
    addPlayer(g, { id: 'Seer', socketId: 'sS' });
    addPlayer(g, { id: 'Wolf', socketId: 'sW' });
    g.roles = { Seer: 'VILLAGER', Wolf: 'WOLF' } as any;

    const role = recordSeerPeek(g, 'Seer', 'Wolf');
    expect(role).toBe('WOLF');

    const seer = g.players.find(p => p.id === 'Seer')!;
    expect(seer.privateLog).toEqual([
      { type: 'SEER_PEEK', targetId: 'Wolf', role: 'WOLF', night: 1 }
    ]);

    expect(g.history[0].events).toEqual([
      { type: 'SEER_PEEK', seerId: 'Seer', targetId: 'Wolf', role: 'WOLF' }
    ]);
  });
});
