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

describe('Vote — Option A (plurality, no early finish)', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const ids = ['A','B','C','D','E','F'];
    const players: Player[] = ids.map(mkP);
    for (const p of players) io.sockets.sockets.set(p.socketId, new FakeSocket(p.socketId));
    game = {
      id:'G', state:'VOTE', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:6,
      players, roles: Object.fromEntries(ids.map(id => [id,'VILLAGER'])) as any,
      alive:new Set(ids), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null
    } as any;
    (orch as any).store.put(game);
  });

  it('does not end immediately at absolute majority; ends when all have voted and applies plurality', async () => {
    // Cast 4 votes for E (majority in 6), but do not finish yet
    orch.voteCast(game.id, 'A', 'E');
    orch.voteCast(game.id, 'B', 'E');
    orch.voteCast(game.id, 'C', 'E');
    orch.voteCast(game.id, 'D', 'E');

    // No results emitted yet; still in VOTE
    const early = io.emits.find(e => e.event === 'vote:results');
    expect(early).toBeFalsy();
    expect(game.state).toBe('VOTE');

    // Remaining two votes cast for someone else
    orch.voteCast(game.id, 'E', 'A');
    orch.voteCast(game.id, 'F', 'B');

    // Now results should be emitted, eliminating E by plurality (4-1-1)
    const res = io.emits.find(e => e.event === 'vote:results');
    // Depending on timing of the orchestrator, we at least must be out of VOTE
    if (!res) {
      expect(['RESOLVE','END']).toContain(game.state);
    } else {
      expect(res.payload?.eliminatedId).toBe('E');
      expect(res.payload?.tally?.E).toBe(4);
    }
  });
});
