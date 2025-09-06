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

describe('witch phase', () => {
  it('skips directly to morning when no witch is alive', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'Wolf1', socketId: 'sW1' });
    addPlayer(g, { id: 'Wolf2', socketId: 'sW2' });
    addPlayer(g, { id: 'Villager', socketId: 'sV' });
    g.roles = { Wolf1: 'WOLF', Wolf2: 'WOLF', Villager: 'VILLAGER' } as any;
    g.players.forEach(p => (p.role = g.roles[p.id]));
    (orch as any).store.put(g);

    g.state = 'NIGHT_WOLVES';
    g.night.attacked = 'Villager';

    await (orch as any).beginNightWitch(g);

    expect(g.state).toBe('END');
  });

  it('skips directly to morning when witch is disconnected', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'Wolf', socketId: 'sW' });
    addPlayer(g, { id: 'Witch', socketId: 'sWi' });
    addPlayer(g, { id: 'Villager', socketId: 'sV' });
    g.roles = { Wolf: 'WOLF', Witch: 'WITCH', Villager: 'VILLAGER' } as any;
    g.players.forEach(p => (p.role = g.roles[p.id]));
    (orch as any).store.put(g);

    // disconnect the witch
    const w = g.players.find(p => p.id === 'Witch')!;
    w.connected = false;

    g.state = 'NIGHT_WOLVES';
    g.night.attacked = 'Villager';

    await (orch as any).beginNightWitch(g);

    expect(g.state).toBe('MORNING');
  });
});

