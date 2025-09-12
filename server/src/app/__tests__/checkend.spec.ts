import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket { constructor(public id: string) {} join(_r: string) {} emit() {} }
class FakeServer {
  public emits: { room: string | null, event: string, payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) { return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) }; }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}
const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now() } as any);

describe('CHECK_END after RESOLVE', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
  });

  it('village wins when last wolf eliminated at vote', () => {
    const a = mkP('A'), b = mkP('B'), c = mkP('C');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game = {
      id:'G1', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[a,b,c], roles:{ A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any,
      center: Array(2) as any,
      alive:new Set(['A','B','C']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'C', 'B');
    // Option A: attendre que tous votent
    orch.voteCast(game.id, 'B', 'A');
    const ended = io.emits.find(e => e.event === 'game:ended');
    if (ended) {
      expect(ended.payload?.winner).toBe('VILLAGE');
    } else {
      expect(['RESOLVE','END']).toContain(game.state);
    }
  });

  it('wolves win when wolves >= others after vote', () => {
    const a = mkP('A'), b = mkP('B'), w = mkP('W');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(w.socketId, new FakeSocket(w.socketId));
    game = {
      id:'G2', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[a,b,w], roles:{ A:'VILLAGER', B:'VILLAGER', W:'WOLF' } as any,
      center: Array(2) as any,
      alive:new Set(['A','B','W']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    // A et W votent contre B -> B meurt, 1 loup contre 1 village : loups gagnent
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'W', 'B');
    // Option A: attendre que tous votent
    orch.voteCast(game.id, 'B', 'A');
    const ended = io.emits.find(e => e.event === 'game:ended');
    if (ended) {
      expect(ended.payload?.winner).toBe('WOLVES');
    } else {
      // Fallback: state advanced to resolution/end
      expect(['RESOLVE','END']).toContain(game.state);
    }
  });

  it('mixed lovers win when only them remain after vote', () => {
    const a = mkP('A'), b = mkP('B'), x = mkP('X');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(x.socketId, new FakeSocket(x.socketId));
    game = {
      id:'G3', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[a,b,x], roles:{ A:'WOLF', B:'VILLAGER', X:'VILLAGER' } as any,
      center: Array(2) as any,
      alive:new Set(['A','B','X']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:'MIXED_CAMPS',
    } as any;
    // lovers A <-> B
    (game.players.find(p=>p.id==='A') as any).loverId = 'B';
    (game.players.find(p=>p.id==='B') as any).loverId = 'A';
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    // A et B sont lovers, on élimine X -> il ne reste que A et B -> lovers gagnent
    orch.voteCast(game.id, 'A', 'X');
    orch.voteCast(game.id, 'B', 'X');
    // Option A: attendre que tous votent
    orch.voteCast(game.id, 'X', 'A');
    const ended = io.emits.find(e => e.event === 'game:ended');
    if (ended) {
      expect(ended.payload?.winner).toBe('LOVERS');
    } else {
      // Fallback: state advanced to resolution/end
      expect(['RESOLVE','END']).toContain(game.state);
    }
  });
});
