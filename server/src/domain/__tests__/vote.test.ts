import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, computeVoteResult } from '../rules.js';

describe('vote ties', () => {
  it('no elimination on tie', () => {
    const g = createGame('V2');
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);

    g.votes = { A: 'B', B: 'C', C: 'A' };
    const { eliminated } = computeVoteResult(g);
    expect(eliminated).toBeNull();
  });
});
