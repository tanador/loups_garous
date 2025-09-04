import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, targetsForWitch, canBeSaved } from '../rules.js';

describe('assign roles', () => {
  it('2-wolf game has 2 wolves + 1 witch', () => {
    const g = createGame({ maxPlayers: 3, wolves: 2 });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(2);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
  });

  it('1-wolf game has 1 wolf + 1 witch + 1 villager', () => {
    const g = createGame({ maxPlayers: 3, wolves: 1 });
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

describe('witch mechanics', () => {
  it('witch cannot target herself with poison', () => {
    const g = createGame({ maxPlayers: 3, wolves: 2 });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const wid = g.players.find(p => g.roles[p.id] === 'WITCH')!.id;
    const targets = targetsForWitch(g);
    expect(targets).not.toContain(wid);
  });

  it('canBeSaved returns true only when heal potion unused and player attacked', () => {
    const g = createGame({ maxPlayers: 3, wolves: 2 });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    g.night.attacked = 'A';
    expect(canBeSaved(g, 'A')).toBe(true);
    g.inventory.witch.healUsed = true;
    expect(canBeSaved(g, 'A')).toBe(false);
  });
});
