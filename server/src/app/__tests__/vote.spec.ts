// Tests couvrant les scénarios de vote et de revote (égalité, limitation des cibles).
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

describe('Vote flow', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    vi.useFakeTimers();
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const a = mkP('A'); const b = mkP('B');
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:2,
      players:[a,b], roles:{ A:'VILLAGER', B:'WOLF' } as any,
      alive:new Set(['A','B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null
    };
    // Enregistre le jeu dans le store interne de l'orchestrateur pour les méthodes by-id
    (orch as any).store.put(game);
  });

  it('revote only targets tied players after first round tie', async () => {
    const c = mkP('C'); const d = mkP('D');
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    io.sockets.sockets.set(d.socketId, new FakeSocket(d.socketId));
    game.players.push(c, d);
    game.roles = { A:'VILLAGER', B:'WOLF', C:'VILLAGER', D:'VILLAGER' } as any;
    game.alive = new Set(['A','B','C','D']);

    (orch as any).beginVote(game);
    // Tie between A and B (2 votes each)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'A');
    orch.voteCast(game.id, 'D', 'B');
    const tie = io.emits.find(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tie).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3000);
    const options = io.emits.filter(e => e.event === 'vote:options');
    const revote = options[options.length - 1];
    expect(revote.payload.alive.map((p:any) => p.id).sort()).toEqual(['A','B']);
  });

  it('revote resolves to elimination on second round and can end the game', async () => {
    // 3 joueurs pour éviter une nouvelle égalité: A (villager), B (wolf), C (villager)
    const c = mkP('C');
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game.players.push(c);
    game.roles = { A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any;
    game.alive = new Set(['A','B','C']);

    (orch as any).beginVote(game);
    // Premier tour: égalité A vs B (C vote pour lui-même pour clôturer le tour)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tie = io.emits.find(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tie).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3000);
    const revote = io.emits.find(e => e.event === 'vote:options');
    expect(revote).toBeTruthy();

    // Second tour (Option A: pas de clôture anticipée) :
    // A et C votent B, puis B vote (peu importe la cible) -> clôture
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'C', 'B');
    orch.voteCast(game.id, 'B', 'A');
    // Le serveur doit pouvoir déclarer la fin (plus de loup): 'game:ended' émis
    const ended = io.emits.find(e => e.event === 'game:ended');
    if (ended) {
      expect(ended.payload?.winner).toBe('VILLAGE');
    } else {
      expect(['RESOLVE','END']).toContain(game.state);
    }
  });

  it('second tie ends without elimination and no further revote', async () => {
    const c = mkP('C');
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game.players = [ ...game.players.slice(0,2), c ];
    game.roles = { A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any;
    game.alive = new Set(['A','B','C']);
    (orch as any).store.put(game);

    (orch as any).beginVote(game);
    // First round tie (1-1-1)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tie1 = io.emits.find(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tie1).toBeTruthy();
    const before = io.emits.filter(e => e.event === 'vote:options').length;
    await vi.advanceTimersByTimeAsync(3000);
    const after = io.emits.filter(e => e.event === 'vote:options').length;
    expect(after).toBeGreaterThan(before);

    // Second round tie again
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tieEvents = io.emits.filter(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tieEvents.length).toBe(2);
    const optBefore = io.emits.filter(e => e.event === 'vote:options').length;
    await vi.advanceTimersByTimeAsync(3000);
    const optAfter = io.emits.filter(e => e.event === 'vote:options').length;
    expect(optAfter).toBe(optBefore);
  });
});
