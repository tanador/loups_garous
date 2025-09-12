import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket { constructor(public id: string) {} join(_r: string) {} leave(_r: string) {} emit() {} }
class FakeServer {
  public emits: { room: string | null, event: string, payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) { return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) }; }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}

const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now(), privateLog: [] } as any);

describe('Thief (Voleur) night 0 flow', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    vi.useFakeTimers();
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const t = mkP('THIEF'); const a = mkP('A'); const b = mkP('B');
    io.sockets.sockets.set(t.socketId, new FakeSocket(t.socketId));
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G', state:'ROLES', createdAt:Date.now(), updatedAt:Date.now(), round:0, maxPlayers:3,
      players:[t,a,b], roles:{ THIEF:'THIEF', A:'VILLAGER', B:'VILLAGER' } as any,
      alive:new Set(['THIEF','A','B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
      pendingDeaths: [], deferredGrief: [], centerCards: ['WOLF','WITCH'] as any,
    } as any;
    (orch as any).store.put(game);
    // bind rooms
    ;(orch as any).bindPlayerToRooms(game, game.players[0], io.sockets.sockets.get(t.socketId) as any);
  });

  it('wakes the thief and accepts a swap to index 0', () => {
    (orch as any).beginNightThief(game);
    // swap to index 0
    orch.thiefChoose(game.id, 'THIEF', 'swap', 0);
    expect(game.roles['THIEF']).toBe('WOLF');
    expect((game.centerCards ?? []).includes('THIEF' as any)).toBe(true);
  });

  it('forces swap when both center cards are wolves', () => {
    game.centerCards = ['WOLF','WOLF'] as any;
    (orch as any).beginNightThief(game);
    expect(() => orch.thiefChoose(game.id, 'THIEF', 'keep')).toThrowError();
    orch.thiefChoose(game.id, 'THIEF', 'swap', 1);
    expect(game.roles['THIEF']).toBe('WOLF');
  });
});
