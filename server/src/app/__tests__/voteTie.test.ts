import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';
import { assignRoles } from '../../domain/rules.js';

function fakeIo(calls: any[]) {
  return {
    to: () => ({ emit: (event: string, data: any) => calls.push({ event, data }) }),
    emit: () => {},
    sockets: { sockets: new Map() }
  } as any;
}

describe('vote ties', () => {
  it('requests a revote when there is a tie', () => {
    vi.useFakeTimers();
    const calls: any[] = [];
    const orch = new Orchestrator(fakeIo(calls));
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    assignRoles(g);
    (orch as any).store.put(g);
    g.state = 'MORNING';
    (orch as any).beginVote(g);

    orch.voteCast(g.id, 'A', 'B');
    orch.voteCast(g.id, 'B', 'A');
    orch.voteCast(g.id, 'C', 'C');

    // one result for the tie
    expect(calls.filter(c => c.event === 'vote:results').length).toBe(1);
    // initial options
    expect(calls.filter(c => c.event === 'vote:options').length).toBe(1);

    vi.advanceTimersByTime(1_000);

    // revote options after tie
    expect(calls.filter(c => c.event === 'vote:options').length).toBe(2);
    vi.useRealTimers();
  });
});
