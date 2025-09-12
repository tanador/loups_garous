// Tests du rôle Voyante côté serveur.
//
// La voyante est un personnage clé de *Loup Garou* : chaque nuit elle
// choisit un joueur et découvre secrètement son rôle. Ces tests
// s'assurent que cette interaction reste privée, que les cibles sont
// correctement validées et que l'enchaînement "réveil → sondage → ACK
// → sommeil" se déroule comme prévu.
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

// Utilisation directe de `seerProbe` sans passer par l'orchestration complète.
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

// --- Phase complète: tests utilisant le réveil/sommeil orchestré de la voyante.
class FakeSocket2 {
  public emits: { event: string; payload: any }[] = [];
  constructor(public id: string) {}
  join(_r: string) {}
  emit(event: string, payload: any) { this.emits.push({ event, payload }); }
}
class FakeServer2 {
  public emits: { room: string | null; event: string; payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket2>() };
  to(room: string) { return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) }; }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}
const mkP2 = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now() } as any);

// Scénario complet: la voyante est réveillée, choisit une cible puis se rendort.
describe('Seer peek flow', () => {
  let io: FakeServer2; let orch: Orchestrator; let game: Game; let seerSock: FakeSocket2;
  beforeEach(() => {
    io = new FakeServer2(); orch = new Orchestrator(io as any);
    const seer = mkP2('SEER'); const a = mkP2('A'); const b = mkP2('B');
    seerSock = new FakeSocket2(seer.socketId);
    io.sockets.sockets.set(seer.socketId, seerSock);
    io.sockets.sockets.set(a.socketId, new FakeSocket2(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket2(b.socketId));
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
    // Pas de sleep tant que la voyante n'a pas ACK
    const sleepBefore = seerSock.emits.find(e => e.event === 'seer:sleep');
    expect(sleepBefore).toBeFalsy();
    // Après ACK: passage à la suite et emission de sleep
    (orch as any).seerAck(game.id, 'SEER');
    const sleepAfter = seerSock.emits.find(e => e.event === 'seer:sleep');
    expect(sleepAfter).toBeTruthy();
    expect((game as any).privateLog.length).toBe(1);
    expect((game as any).privateLog[0].target).toBe('A');
  });
});
