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

describe('Wolves unanimous choice progresses phase', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as any);
    const w1 = mkP('W1'); const w2 = mkP('W2');
    const v1 = mkP('V1'); const v2 = mkP('V2');
    io.sockets.sockets.set(w1.socketId, new FakeSocket(w1.socketId));
    io.sockets.sockets.set(w2.socketId, new FakeSocket(w2.socketId));
    io.sockets.sockets.set(v1.socketId, new FakeSocket(v1.socketId));
    io.sockets.sockets.set(v2.socketId, new FakeSocket(v2.socketId));
    game = {
      id: 'G', state: 'CHECK_END', createdAt: Date.now(), updatedAt: Date.now(), round: 0, maxPlayers: 4,
      players: [w1, w2, v1, v2],
      roles: { W1: 'WOLF', W2: 'WOLF', V1: 'VILLAGER', V2: 'VILLAGER' } as any,
      alive: new Set(['W1','W2','V1','V2']),
      night: {}, inventory: { witch: { healUsed:false, poisonUsed:false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null,
    } as any;
    (orch as any).store.put(game);
    (orch as any).beginNightWolves(game); // transition to NIGHT_WOLVES
  });

  it('records votes and leaves wolves phase on consensus', async () => {
    vi.useFakeTimers();
    orch.wolvesChoose(game.id, 'W1', 'V1');
    expect(game.wolvesChoices['W1']).toBe('V1');
    orch.wolvesChoose(game.id, 'W2', 'V1');
    await vi.runAllTimersAsync();
    expect(game.night.attacked).toBe('V1');
    expect(game.state).not.toBe('NIGHT_WOLVES');
    vi.useRealTimers();
  });
});
