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
  it('advances to vote when all alive players ack', () => {
    vi.useFakeTimers();
    const orch = new Orchestrator(fakeIo());
    const g = createGame({ maxPlayers: 3, wolves: 2 });
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    (orch as any).store.put(g);

    g.state = 'NIGHT_WITCH';
    (orch as any).beginMorning(g);
    expect(g.state).toBe('MORNING');

    orch.dayAck(g.id, 'A');
    orch.dayAck(g.id, 'B');
    expect(g.state).toBe('MORNING');
    orch.dayAck(g.id, 'C');
    expect(g.state).toBe('VOTE');
    vi.useRealTimers();
  });
});
