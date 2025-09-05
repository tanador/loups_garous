import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { applyDeaths } from '../rules.js';

function setup() {
  const g = createGame(4);
  addPlayer(g, { id: 'Wolf', socketId: 'sW' });
  addPlayer(g, { id: 'Hunter', socketId: 'sH' });
  addPlayer(g, { id: 'Witch', socketId: 'sWi' });
  addPlayer(g, { id: 'Villager', socketId: 'sV' });
  g.roles = { Wolf: 'WOLF', Hunter: 'HUNTER', Witch: 'WITCH', Villager: 'VILLAGER' };
  g.players.forEach(p => (p.role = g.roles[p.id]));
  return g;
}

describe('hunter ability', () => {
  it('night kill triggers a shot', async () => {
    const g = setup();
    await applyDeaths(g, ['Hunter'], () => 'Wolf');
    expect(g.alive.has('Hunter')).toBe(false);
    expect(g.alive.has('Wolf')).toBe(false);
  });

  it('vote execution triggers a shot', async () => {
    const g = setup();
    await applyDeaths(g, ['Hunter'], () => 'Villager');
    expect(g.alive.has('Hunter')).toBe(false);
    expect(g.alive.has('Villager')).toBe(false);
    expect(g.alive.has('Wolf')).toBe(true);
  });

  it('two hunters dying resolve without loops', async () => {
    const g = createGame(3);
    addPlayer(g, { id: 'H1', socketId: 's1' });
    addPlayer(g, { id: 'H2', socketId: 's2' });
    addPlayer(g, { id: 'W', socketId: 's3' });
    g.roles = { H1: 'HUNTER', H2: 'HUNTER', W: 'WOLF' };
    g.players.forEach(p => (p.role = g.roles[p.id]));
    await applyDeaths(g, ['H1', 'H2'], (hid) => (hid === 'H1' ? 'H2' : 'H1'));
    expect(g.alive.has('H1')).toBe(false);
    expect(g.alive.has('H2')).toBe(false);
    expect(g.alive.has('W')).toBe(true);
  });
});
