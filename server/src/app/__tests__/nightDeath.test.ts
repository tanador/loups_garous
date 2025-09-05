import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';

function fakeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() }
  } as any;
}

describe('night death resolution', () => {
  it('sends snapshots and removes killed players in morning', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'Wolf', socketId: 'sW' });
    addPlayer(g, { id: 'Witch', socketId: 'sWi' });
    addPlayer(g, { id: 'Villager', socketId: 'sV' });
    g.roles = { Wolf: 'WOLF', Witch: 'WITCH', Villager: 'VILLAGER' };
    g.players.forEach(p => (p.role = g.roles[p.id]));
    (orch as any).store.put(g);

    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'Villager';

    const spy = vi.spyOn(orch as any, 'sendSnapshot');
    await (orch as any).beginMorning(g);

    expect(g.alive.has('Villager')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
