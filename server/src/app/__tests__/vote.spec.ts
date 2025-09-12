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

  it('tie triggers re-vote (vote:options after tie results)', async () => {
    // Add a third player to avoid immediate END on parity (wolves >= others)
    const c = mkP('C');
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game.players.push(c);
    game.roles = { A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any;
    game.alive = new Set(['A','B','C']);

    (orch as any).beginVote(game);
    // A vote B, B vote A, C vote C -> égalité
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tie = io.emits.find(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tie).toBeTruthy();
    // Avance le temps pour déclencher le re-vote
    await vi.advanceTimersByTimeAsync(3000);
    const revote = io.emits.find(e => e.event === 'vote:options');
    expect(revote).toBeTruthy();
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

  it('revote with tie again leads to another vote:options emission', async () => {
    // Use 3 players to allow ties without immediate END on parity
    const c = mkP('C');
    io.sockets.sockets.set(c.socketId, new FakeSocket(c.socketId));
    game.players = [ ...game.players.slice(0,2), c ];
    game.roles = { A:'VILLAGER', B:'WOLF', C:'VILLAGER' } as any;
    game.alive = new Set(['A','B','C']);
    (orch as any).store.put(game);

    ;(orch as any).beginVote(game);
    // First round tie (1-1-1)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tie1 = io.emits.find(e => e.event === 'vote:results' && e.payload?.eliminatedId === null);
    expect(tie1).toBeTruthy();
    // One re-vote options emitted after 3s
    const beforeCount = io.emits.filter(e => e.event === 'vote:options').length;
    await vi.advanceTimersByTimeAsync(3000);
    const afterCount = io.emits.filter(e => e.event === 'vote:options').length;
    expect(afterCount).toBeGreaterThan(beforeCount);

    // Second round tie again (1-1-1)
    orch.voteCast(game.id, 'A', 'B');
    orch.voteCast(game.id, 'B', 'A');
    orch.voteCast(game.id, 'C', 'C');
    const tie2 = io.emits.filter(e => e.event === 'vote:results' && e.payload?.eliminatedId === null).length;
    expect(tie2).toBeGreaterThan(1);
    const before2 = io.emits.filter(e => e.event === 'vote:options').length;
    await vi.advanceTimersByTimeAsync(3000);
    const after2 = io.emits.filter(e => e.event === 'vote:options').length;
    expect(after2).toBeGreaterThan(before2);
  });
});
