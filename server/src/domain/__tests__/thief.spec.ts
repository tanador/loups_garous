import { describe, it, expect } from 'vitest';
import { ROLE_REGISTRY, ROLE_REGISTRY_READY, ROLE_SETUPS } from '../roles/index.js';
import { createGame, addPlayer } from '../game.js';
import { assignRoles } from '../rules.js';

// Ensure the THIEF role is registered and available in setups

describe('THIEF role', () => {
  it('is registered in the role registry', async () => {
    await ROLE_REGISTRY_READY;
    expect(ROLE_REGISTRY.THIEF).toBeDefined();
  });

  it('is included with default counts in all setups', () => {
    for (const setup of Object.values(ROLE_SETUPS)) {
      expect(setup.THIEF).toEqual({ min: 0, max: 1 });
    }
  });

  it('replaces thief with villager and populates center', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g, () => 5);
    const values = Object.values(g.roles);
    expect(values.filter((r) => r === 'THIEF').length).toBe(0);
    expect(values.filter((r) => r === 'VILLAGER').length).toBe(2);
    expect([...g.center].sort()).toEqual(['THIEF', 'VILLAGER'].sort());
  });
});
