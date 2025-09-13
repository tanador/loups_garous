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

describe('Day recap with elimination waits all survivors acks', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => { io = new FakeServer(); orch = new Orchestrator(io as any); });

  it('requires all survivors to ack before leaving RESOLVE', async () => {
    const a = mkP('A'); const b = mkP('B'); const c = mkP('C'); const d = mkP('D');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    io.sockets.sockets.set(d.socketId, new FakeSocket(d.socketId));
    game = {
      id:'G', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:4,
      players:[a,b,c,d], roles:{ A:'WOLF', B:'VILLAGER', C:'VILLAGER', D:'VILLAGER' } as any,
      alive:new Set(['A','B','C','D']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginVote(game);

    // Votes -> eliminate B (villager). Survivors: A,C,D (3 acks needed)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'C', 'B');
    orch.voteCast(game.id, 'D', 'B');
    orch.voteCast(game.id, 'B', 'A');

    expect(game.state).toBe('RESOLVE');
    // Partial acks should not advance
    orch.dayAck(game.id, 'A');
    expect(game.state).toBe('RESOLVE');
    orch.dayAck(game.id, 'C');
    expect(game.state).toBe('RESOLVE');
    // Last survivor ack advances
    orch.dayAck(game.id, 'D');
    expect(game.state).toBe('CHECK_END');
  });
});
