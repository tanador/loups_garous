import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, targetsForWitch, canBeSaved } from '../rules.js';

describe('assign roles', () => {
  it('3-player game has 1 wolf, 1 witch and 1 villager', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(1);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
    expect(roles.filter(r => r === 'VILLAGER').length).toBe(1);
  });

  it('4-player game can have 2 wolves', () => {
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    assignRoles(g, () => 1); // force 2 wolves
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(2);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
    expect(roles.filter(r => r === 'HUNTER').length).toBe(1);
  });

  it('4-player game can have 1 wolf', () => {
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    assignRoles(g, () => 0); // force 1 wolf
    const roles = Object.values(g.roles);
    expect(roles.filter(r => r === 'WOLF').length).toBe(1);
    expect(roles.filter(r => r === 'WITCH').length).toBe(1);
    expect(roles.filter(r => r === 'HUNTER').length).toBe(1);
    expect(roles.filter(r => r === 'VILLAGER').length).toBe(1);
  });
});

describe('witch mechanics', () => {
  it('witch cannot target herself with poison', () => {
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    const wid = g.players.find(p => g.roles[p.id] === 'WITCH')!.id;
    const targets = targetsForWitch(g);
    expect(targets).not.toContain(wid);
  });

  it('canBeSaved returns true only when heal potion unused and player attacked', () => {
    const g = createGame(3);
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
