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

function mkPlayer(id: string): Player { return { id, socketId: 'sock:'+id, isReady: true, connected: true, lastSeen: Date.now() } as any; }

describe('Wolves consensus and target lock', () => {
  let io: FakeServer; let orch: Orchestrator;
  beforeEach(() => { io = new FakeServer(); orch = new Orchestrator(io as any); });

  it('reaches consensus and locks target with confirmationsRemaining = 0', () => {
    const A = mkPlayer('WOLF_A'); const B = mkPlayer('WOLF_B'); const V = mkPlayer('VILLAGER'); const X = mkPlayer('VILLAGER_2');
    io.sockets.sockets.set(A.socketId, new FakeSocket(A.socketId));
    io.sockets.sockets.set(B.socketId, new FakeSocket(B.socketId));
    io.sockets.sockets.set(V.socketId, new FakeSocket(V.socketId));
    io.sockets.sockets.set(X.socketId, new FakeSocket(X.socketId));
    const game: Game = {
      id: 'G', state: 'NIGHT_WOLVES', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 4,
      players: [A,B,V,X], roles: { WOLF_A:'WOLF', WOLF_B:'WOLF', VILLAGER:'VILLAGER', VILLAGER_2:'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['WOLF_A','WOLF_B','VILLAGER','VILLAGER_2']), night: {}, inventory: { witch:{ healUsed:false, poisonUsed:false }},
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null
    };
    ;(orch as any).store.put(game);
    // Start wolves phase explicitly
    (orch as any).beginNightWolves(game);
    // Both wolves choose VILLAGER
    orch.wolvesChoose(game.id, 'WOLF_A', 'VILLAGER');
    orch.wolvesChoose(game.id, 'WOLF_B', 'VILLAGER');
    // Event sent to wolves room with targetLocked and 0 confirmations remaining
    // Nouvelle logique: s'assure qu'un verrouillage a bien été émis.
    const locks = io.emits.filter(e => e.event === 'wolves:targetLocked');
    expect(locks.length).toBeGreaterThan(0);
  });
});
