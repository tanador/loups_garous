import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket {
  public emits: { event: string; payload: any }[] = [];
  constructor(public id: string) {}
  join(_r: string) {}
  emit(event: string, payload: any) { this.emits.push({ event, payload }); }
}
class FakeServer {
  public emits: { room: string | null; event: string; payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) { return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) }; }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}
const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now() } as any);

describe('Seer peek flow', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game; let seerSock: FakeSocket;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const seer = mkP('SEER'); const a = mkP('A'); const b = mkP('B');
    seerSock = new FakeSocket(seer.socketId);
    io.sockets.sockets.set(seer.socketId, seerSock);
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G', state:'NIGHT_SEER', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[seer,a,b], roles:{ SEER:'SEER', A:'VILLAGER', B:'WOLF' } as any,
      alive:new Set(['SEER','A','B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], privateLog:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null
    } as any;
    (orch as any).store.put(game);
  });

  it('wakes seer with alive players', () => {
    game.state = 'NIGHT_LOVERS';
    (orch as any).beginNightSeer(game);
    const wake = seerSock.emits.find(e => e.event === 'seer:wake');
    expect(wake).toBeTruthy();
    expect(wake!.payload.alive.map((p: any) => p.id)).toEqual(['A','B']);
  });

  it('validates and reveals target role', () => {
    expect(() => orch.seerPeek(game.id, 'SEER', 'SEER')).toThrowError('invalid_target');
    game.alive.delete('B');
    expect(() => orch.seerPeek(game.id, 'SEER', 'B')).toThrowError('invalid_target');
    game.alive.add('B');
    orch.seerPeek(game.id, 'SEER', 'A');
    const reveal = seerSock.emits.find(e => e.event === 'seer:reveal');
    expect(reveal).toBeTruthy();
    expect(reveal!.payload.role).toBe('VILLAGER');
    const sleep = seerSock.emits.find(e => e.event === 'seer:sleep');
    expect(sleep).toBeTruthy();
    expect((game as any).privateLog.length).toBe(1);
    expect((game as any).privateLog[0].target).toBe('A');
  });
});
