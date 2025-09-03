import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles } from '../rules.js';

describe('assign roles', () => {
  it('V1 has 2 wolves + 1 witch', () => {
    const g = createGame('V1');
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(2);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
  });

  it('V2 has 1 wolf + 1 witch + 1 villager', () => {
    const g = createGame('V2');
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(1);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
    expect(roles.filter(r => r === 'VILLAGER').length).toBe(1);
  });
});
