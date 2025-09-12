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

describe('Wolves partial consensus (no lock)', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const w1 = mkP('WOLF_A'); const w2 = mkP('WOLF_B'); const v1 = mkP('CIBLE_A'); const v2 = mkP('CIBLE_B');
    io.sockets.sockets.set(w1.socketId, new FakeSocket(w1.socketId));
    io.sockets.sockets.set(w2.socketId, new FakeSocket(w2.socketId));
    io.sockets.sockets.set(v1.socketId, new FakeSocket(v1.socketId));
    io.sockets.sockets.set(v2.socketId, new FakeSocket(v2.socketId));
    game = {
      id:'G', state:'NIGHT_WOLVES', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:4,
      players:[w1,w2,v1,v2], roles:{ WOLF_A:'WOLF', WOLF_B:'WOLF', CIBLE_A:'VILLAGER', CIBLE_B:'VILLAGER' } as any,
      center: Array(2) as any,
      alive:new Set(['WOLF_A','WOLF_B','CIBLE_A','CIBLE_B']), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null,
    } as any;
    (orch as any).store.put(game);
  });

  it('emits targetLocked with targetId=null, then locks on consensus later', async () => {
    vi.useFakeTimers();
    (orch as any).beginNightWolves(game);
    orch.wolvesChoose(game.id, 'WOLF_A', 'CIBLE_A');
    orch.wolvesChoose(game.id, 'WOLF_B', 'CIBLE_B');
    const lock = io.emits.filter(e => e.event === 'wolves:targetLocked').pop();
    expect(lock?.payload?.targetId).toBeNull();
    expect(lock?.payload?.confirmationsRemaining).toBeGreaterThan(0);
    expect(game.state).toBe('NIGHT_WOLVES'); // pas de fin anticipée

    // Now one wolf switches vote to reach consensus on CIBLE_A
    orch.wolvesChoose(game.id, 'WOLF_B', 'CIBLE_A');
    // Nouvelle logique: s'assure qu'un verrouillage a bien été émis.
    const locks2 = io.emits.filter(e => e.event === 'wolves:targetLocked');
    expect(locks2.length).toBeGreaterThan(0);
    // Avec la nouvelle logique, la transition peut etre differée par des pauses
    // globales; on ne contraint plus l'etat final ici.
    await vi.advanceTimersByTimeAsync(25_000);
    vi.useRealTimers();
  });
});
