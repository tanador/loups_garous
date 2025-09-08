import { describe, it, expect } from 'vitest';
import { onPlayerDeath, resolveDeaths } from '../../domain/rules.js';
import type { Game } from '../../domain/types.js';

function makeGameWithLovers(): Game {
  const players = ['A','B','X'].map(id => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now(), loverId: undefined as string | undefined }));
  // Lovers A <-> B
  players[0].loverId = 'B';
  players[1].loverId = 'A';
  return {
    id:'G', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
    players: players as any, roles: { A:'VILLAGER', B:'WOLF', X:'VILLAGER' } as any,
    alive: new Set(['A','B','X']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
    votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode: 'MIXED_CAMPS'
  } as any;
}

describe('Lovers grief chain', () => {
  it('lover dies of grief when partner dies (no defer)', async () => {
    const g = makeGameWithLovers();
    // Partner A dies
    onPlayerDeath(g, 'A', 'TEST');
    const { deaths } = await resolveDeaths(g, undefined, {});
    // Both A and B must be dead now (B by GRIEF)
    expect(g.alive.has('A')).toBe(false);
    expect(g.alive.has('B')).toBe(false);
    expect(deaths).toEqual(expect.arrayContaining(['A','B']));
  });
});

