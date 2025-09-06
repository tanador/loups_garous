import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';

function fakeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() }
  } as any;
}

describe('wolves phase', () => {
  it('skips directly to witch phase when no wolves are connected', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'Wolf', socketId: 'sW' });
    addPlayer(g, { id: 'Witch', socketId: 'sWi' });
    addPlayer(g, { id: 'Villager', socketId: 'sV' });
    g.roles = { Wolf: 'WOLF', Witch: 'WITCH', Villager: 'VILLAGER' } as any;
    g.players.forEach(p => (p.role = g.roles[p.id]));
    const w = g.players.find(p => p.id === 'Wolf')!;
    w.connected = false;
    (orch as any).store.put(g);

    g.state = 'ROLES';

    await (orch as any).beginNightWolves(g);

    expect(g.state).toBe('NIGHT_WITCH');
  });
});
