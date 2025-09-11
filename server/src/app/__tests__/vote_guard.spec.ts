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

const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady: true, connected: true, lastSeen: Date.now() } as any);

describe('Vote guards when a winner already exists', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => { io = new FakeServer(); orch = new Orchestrator(io as any); });

  it('ends immediately when only one survivor remains before opening a vote (villager)', () => {
    const a = mkP('A');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    game = {
      id:'G1', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:1,
      players:[a], roles:{ A:'VILLAGER' } as any,
      alive: new Set(['A']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    const ended = io.emits.find(e => e.event === 'game:ended');
    expect(ended).toBeTruthy();
    expect(ended?.payload?.winner).toBe('VILLAGE');
    const options = io.emits.find(e => e.event === 'vote:options');
    expect(options).toBeFalsy();
  });

  it('ends immediately when only one survivor remains before opening a vote (wolf)', () => {
    const w = mkP('W');
    io.sockets.sockets.set(w.socketId, new FakeSocket(w.socketId));
    game = {
      id:'G2', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:1,
      players:[w], roles:{ W:'WOLF' } as any,
      alive: new Set(['W']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    const ended = io.emits.find(e => e.event === 'game:ended');
    expect(ended).toBeTruthy();
    expect(ended?.payload?.winner).toBe('WOLVES');
    const options = io.emits.find(e => e.event === 'vote:options');
    expect(options).toBeFalsy();
  });

  it('ends immediately when two mixed-camps lovers remain before opening a vote', () => {
    const a = mkP('A'); const b = mkP('B');
    (a as any).loverId = 'B'; (b as any).loverId = 'A';
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G3', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:2,
      players:[a,b], roles:{ A:'WOLF', B:'VILLAGER' } as any,
      alive: new Set(['A','B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:'MIXED_CAMPS',
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);
    const ended = io.emits.find(e => e.event === 'game:ended');
    expect(ended).toBeTruthy();
    expect(ended?.payload?.winner).toBe('LOVERS');
    const options = io.emits.find(e => e.event === 'vote:options');
    expect(options).toBeFalsy();
  });
});

