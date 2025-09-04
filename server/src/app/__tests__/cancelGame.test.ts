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

describe('cancel game', () => {
  it('removes game and notifies players', () => {
    const events: any[] = [];
    const orch = new Orchestrator(fakeIo(events));
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    (orch as any).store.put(g);

    orch.cancelGame(g.id, 'A');

    expect((orch as any).store.get(g.id)).toBeUndefined();
    expect(events.find(e => e.ev === 'game:cancelled')).toBeTruthy();
    expect(events.find(e => e.ev === 'lobby:updated')).toBeTruthy();
  });
});
