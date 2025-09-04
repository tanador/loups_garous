import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';

function fakeIo(events: any[]) {
  return {
    to: (room: string) => ({ emit: (ev: string, data?: any) => events.push({ room, ev, data }) }),
    emit: (ev: string, data?: any) => events.push({ room: null, ev, data }),
    sockets: { sockets: new Map() }
  } as any;
}

describe('leave game', () => {
  it('removes player and updates lobby', () => {
    const events: any[] = [];
    const orch = new Orchestrator(fakeIo(events));
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    (orch as any).store.put(g);

    orch.leaveGame(g.id, 'B');

    const updated = (orch as any).store.get(g.id);
    expect(updated.players.map((p: any) => p.id)).toEqual(['A']);
    expect(events.find(e => e.ev === 'lobby:updated')).toBeTruthy();
    expect(events.find(e => e.ev === 'game:snapshot')).toBeTruthy();
  });

  it('cancels game if owner leaves', () => {
    const events: any[] = [];
    const orch = new Orchestrator(fakeIo(events));
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    (orch as any).store.put(g);

    orch.leaveGame(g.id, 'A');

    expect((orch as any).store.get(g.id)).toBeUndefined();
    expect(events.find(e => e.ev === 'game:cancelled')).toBeTruthy();
  });
});

