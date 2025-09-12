import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket {
  public events: { event: string; payload: any }[] = [];
  constructor(public id: string) {}
  join(_r: string) {}
  emit(event: string, payload: any) {
    this.events.push({ event, payload });
  }
}
class FakeServer {
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(_r: string) {
    return { emit: (_e: string, _p: any) => {} };
  }
  emit(_e: string, _p: any) {}
}
const mkP = (id: string): Player => ({
  id,
  socketId: 's:' + id,
  isReady: true,
  connected: true,
  lastSeen: Date.now(),
} as any);

describe('Seer probes', () => {
  let io: FakeServer;
  let orch: Orchestrator;
  let game: Game;
  let seerSock: FakeSocket;
  let wolfSock: FakeSocket;
  let thiefSock: FakeSocket;
  let aSock: FakeSocket;

  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as any);
    const seer = mkP('SEER');
    const thief = mkP('THIEF');
    const A = mkP('A');
    const B = mkP('B');
    seerSock = new FakeSocket(seer.socketId); io.sockets.sockets.set(seer.socketId, seerSock);
    thiefSock = new FakeSocket(thief.socketId); io.sockets.sockets.set(thief.socketId, thiefSock);
    aSock = new FakeSocket(A.socketId); io.sockets.sockets.set(A.socketId, aSock);
    wolfSock = new FakeSocket(B.socketId); io.sockets.sockets.set(B.socketId, wolfSock);
    game = {
      id: 'G',
      state: 'NIGHT_SEER',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 1,
      maxPlayers: 4,
      players: [seer, thief, A, B],
      roles: { SEER: 'SEER', THIEF: 'THIEF', A: 'VILLAGER', B: 'WOLF' } as any,
      alive: new Set(['SEER', 'THIEF', 'A', 'B']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set(),
      loversMode: null,
      privateLog: {} as any,
    };
    (orch as any).store.put(game);
  });

  it('reveals exact role only to the seer for a living target', () => {
    orch.seerProbe(game.id, 'SEER', 'B');
    expect(seerSock.events).toEqual([
      { event: 'seer:reveal', payload: { playerId: 'B', role: 'WOLF' } },
    ]);
    expect(wolfSock.events.length).toBe(0);
    expect(thiefSock.events.length).toBe(0);
    expect(aSock.events.length).toBe(0);
  });

  it('rejects self or dead targets with an error and no reveal', () => {
    expect(() => orch.seerProbe(game.id, 'SEER', 'SEER')).toThrow();
    game.alive.delete('B');
    expect(() => orch.seerProbe(game.id, 'SEER', 'B')).toThrow();
    expect(seerSock.events.length).toBe(0);
  });

  it('reflects role changes made by thief before the probe', () => {
    game.roles.THIEF = 'VILLAGER' as any;
    game.roles.A = 'THIEF' as any;
    orch.seerProbe(game.id, 'SEER', 'A');
    expect(seerSock.events[0]).toEqual({
      event: 'seer:reveal',
      payload: { playerId: 'A', role: 'THIEF' },
    });
  });

  it('keeps reveal result in privateLog if seer later dies', () => {
    orch.seerProbe(game.id, 'SEER', 'B');
    game.alive.delete('SEER');
    expect((game as any).privateLog.SEER).toEqual([
      { playerId: 'B', role: 'WOLF' },
    ]);
  });
});
