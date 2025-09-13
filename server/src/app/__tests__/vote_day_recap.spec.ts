import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('Day recap after village vote', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    vi.useFakeTimers();
    io = new FakeServer(); orch = new Orchestrator(io as any);
  });

  // Note: elimination recap is covered implicitly by existing vote specs.
  // This suite focuses on the new recap + acknowledgements for the second tie case.

  it('second tie emits recap with no elimination and waits acks', async () => {
    const a = mkP('A'); const b = mkP('B'); const c = mkP('C');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game = {
      id:'G', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[a,b,c], roles:{ A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any,
      alive:new Set(['A','B','C']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null, dayAcks: new Set(),
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);

    // First round tie 1-1-1
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    await vi.advanceTimersByTimeAsync(3000);
    // Second round tie again
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');

    const recap = io.emits.find(e => e.event === 'day:recap');
    expect(recap).toBeTruthy();
    expect(recap!.payload?.eliminated?.length ?? 0).toBe(0);
    expect(Array.isArray(recap!.payload?.votes)).toBe(true);
    expect(game.state).toBe('RESOLVE');
    expect((orch as any).pendingDayAcks.has(game.id)).toBe(true);

    orch.dayAck(game.id, 'A');
    orch.dayAck(game.id, 'B');
    expect((orch as any).pendingDayAcks.has(game.id)).toBe(true);
    orch.dayAck(game.id, 'C');
    expect((orch as any).pendingDayAcks.has(game.id)).toBe(false);
    expect(game.state).toBe('CHECK_END');
  });
});
