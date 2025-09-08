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

describe('morning acknowledgements', () => {
  it('advances to vote when all alive players ack', async () => {
    vi.useFakeTimers();
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    // Set roles deterministically to avoid an immediate WIN at morning.
    // One wolf and two non-wolves ensures the game proceeds to MORNING and then VOTE.
    g.roles = { A: 'WOLF', B: 'VILLAGER', C: 'VILLAGER' } as any;
    g.players.forEach(p => (p.role = g.roles[p.id] as any));
    (orch as any).store.put(g);

    g.state = 'NIGHT_WITCH';
    await (orch as any).beginMorning(g);
    expect(g.state).toBe('MORNING');

    orch.dayAck(g.id, 'A');
    orch.dayAck(g.id, 'B');
    expect(g.state).toBe('MORNING');
    orch.dayAck(g.id, 'C');
    expect(g.state).toBe('VOTE');
    vi.useRealTimers();
  });
});
