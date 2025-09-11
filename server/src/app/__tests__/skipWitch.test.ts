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

describe('witch phase', () => {
  it('skips directly to morning when no witch is alive', async () => {
    vi.useFakeTimers();
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
    // With global sleep, the state remains NIGHT_WITCH during the pause
    // Advance time to let the flow reach morning/end
    await vi.advanceTimersByTimeAsync(25_000);
    expect(['MORNING','END']).toContain(g.state as any);
    vi.useRealTimers();
  });

  it('skips directly to morning when witch is disconnected', async () => {
    vi.useFakeTimers();
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'Wolf1', socketId: 'sW1' });
    addPlayer(g, { id: 'Wolf2', socketId: 'sW2' });
    addPlayer(g, { id: 'Witch', socketId: 'sWi' });
    g.roles = { Wolf1: 'WOLF', Wolf2: 'WOLF', Witch: 'WITCH' } as any;
    g.players.forEach(p => (p.role = g.roles[p.id]));
    const w = g.players.find(p => p.id === 'Witch')!;
    w.connected = false;
    (orch as any).store.put(g);

    g.state = 'NIGHT_WOLVES';
    g.night.attacked = 'Witch';

    await (orch as any).beginNightWitch(g);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(['MORNING','END']).toContain(g.state as any);
    vi.useRealTimers();
  });
});

