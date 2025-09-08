import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, computeNightDeaths, applyDeaths, winner } from '../rules.js';
import { ROLE_REGISTRY_READY } from '../roles/index.js';
import { beforeAll } from 'vitest';

function seedGame() {
  const g = createGame(3);
  addPlayer(g, { id: 'A', socketId: 'sA' });
  addPlayer(g, { id: 'B', socketId: 'sB' });
  addPlayer(g, { id: 'C', socketId: 'sC' });
  assignRoles(g);
  return g;
}

beforeAll(async () => {
  await ROLE_REGISTRY_READY;
});

describe('night resolution', () => {
  it('heal cancels wolves attack but poison kills target', async () => {
    const g = seedGame();
    g.night.attacked = 'A';
    g.night.saved = 'A';
    g.night.poisoned = 'B';
    const deaths = await computeNightDeaths(g);
    expect(deaths.sort()).toEqual(['B']);
    await applyDeaths(g, deaths);
    expect(g.alive.has('A')).toBe(true);
    expect(g.alive.has('B')).toBe(false);
  });
});

describe('winner checks', () => {
  it('village wins when no wolves', () => {
    const g = seedGame();
    // kill wolves
    for (const [pid, role] of Object.entries(g.roles)) {
      if (role === 'WOLF') g.alive.delete(pid);
    }
    expect(winner(g)).toBe('VILLAGE');
  });

  it('wolves win when no villagers', () => {
    const g = seedGame();
    // kill non-wolves
    for (const [pid, role] of Object.entries(g.roles)) {
      if (role !== 'WOLF') g.alive.delete(pid);
    }
    expect(winner(g)).toBe('WOLVES');
  });
});
