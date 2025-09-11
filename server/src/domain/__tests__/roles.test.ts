import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, targetsForWitch, canBeSaved } from '../rules.js';
import { ROLE_SETUPS } from '../roles/index.js';

function countsOf(roles: Record<string, string>): Record<string, number> {
  const c: Record<string, number> = {};
  Object.values(roles).forEach((r) => (c[r] = (c[r] ?? 0) + 1));
  return c;
}

describe('assign roles (config-agnostic)', () => {
  it('3-player assignment respects setup constraints', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    // Try a few rng values to cover multiple distributions without depending on config ordering
    for (let i = 0; i < 6; i++) {
      assignRoles(g, (max) => i % Math.max(1, max));
      const cnt = countsOf(g.roles);
      // All players receive a role and totals match
      expect(Object.keys(g.roles).length).toBe(3);
      expect(Object.values(cnt).reduce((a, b) => a + b, 0)).toBe(3);
      // Each count within declared min/max for this player count
      const cfg = ROLE_SETUPS[3];
      for (const [role, { min, max }] of Object.entries(cfg)) {
        const n = cnt[role] ?? 0;
        expect(n >= min && n <= max).toBe(true);
      }
    }
  });

  it('4-player assignment respects setup constraints', () => {
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    for (let i = 0; i < 6; i++) {
      assignRoles(g, (max) => i % Math.max(1, max));
      const cnt = countsOf(g.roles);
      expect(Object.keys(g.roles).length).toBe(4);
      expect(Object.values(cnt).reduce((a, b) => a + b, 0)).toBe(4);
      const cfg = ROLE_SETUPS[4];
      for (const [role, { min, max }] of Object.entries(cfg)) {
        const n = cnt[role] ?? 0;
        expect(n >= min && n <= max).toBe(true);
      }
    }
  });
});

describe('witch mechanics (config-agnostic)', () => {
  it('witch cannot target herself with poison', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'W', socketId: 'sW' });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    // set roles deterministically to avoid dependency on external setup
    g.roles = { W: 'WITCH', A: 'VILLAGER', B: 'VILLAGER' } as any;
    g.players.forEach((p) => (p.role = g.roles[p.id] as any));
    const targets = targetsForWitch(g);
    expect(targets).not.toContain('W');
  });

  it('canBeSaved returns true only when heal potion unused and player attacked', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'W', socketId: 'sW' });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    g.roles = { W: 'WITCH', A: 'VILLAGER', B: 'VILLAGER' } as any;
    g.players.forEach((p) => (p.role = g.roles[p.id] as any));
    g.night.attacked = 'A';
    expect(canBeSaved(g, 'A')).toBe(true);
    g.inventory.witch.healUsed = true;
    expect(canBeSaved(g, 'A')).toBe(false);
  });
});
