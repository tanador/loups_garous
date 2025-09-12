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

describe('Thief phase', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game; let thiefSock: FakeSocket;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const thief = mkP('T'); const a = mkP('A'); const b = mkP('B');
    thiefSock = new FakeSocket(thief.socketId); io.sockets.sockets.set(thief.socketId, thiefSock);
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G', state:'ROLES', createdAt:Date.now(), updatedAt:Date.now(), round:0, maxPlayers:3,
      players:[thief,a,b], roles:{ T:'THIEF', A:'VILLAGER', B:'SEER' } as any,
      center:['CUPID','VILLAGER'] as any,
      alive:new Set(['T','A','B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], privateLog:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null
    } as any;
    (orch as any).store.put(game);
    (orch as any).globalSleep = (_g: Game, next: () => void) => next();
  });

  it('swaps role and starts Cupid if thief takes Cupid card', () => {
    (orch as any).beginNightThief(game);
    const wake = thiefSock.emits.find(e => e.event === 'thief:wake');
    expect(wake).toBeTruthy();
    expect(wake!.payload.center).toEqual(['CUPID','VILLAGER']);
    orch.thiefChoose(game.id, 'T', 0);
    expect(game.roles.T).toBe('CUPID');
    expect(game.center[0]).toBe('THIEF');
    const sleep = thiefSock.emits.find(e => e.event === 'thief:sleep');
    expect(sleep).toBeTruthy();
    const cupidWake = thiefSock.emits.find(e => e.event === 'cupid:wake');
    expect(cupidWake).toBeTruthy();
    expect(game.state).toBe('NIGHT_CUPID');
  });
});
