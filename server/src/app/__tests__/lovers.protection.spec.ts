import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('Lovers cannot harm each other', () => {
  let io: FakeServer; let orch: Orchestrator;
  beforeEach(() => { vi.useFakeTimers(); io = new FakeServer(); orch = new Orchestrator(io as any); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('wolf lover cannot choose their lover', () => {
    const a = mkP('A'); const b = mkP('B');
    a.loverId = 'B'; b.loverId = 'A';
    const game: Game = {
      id: 'G1', state: 'NIGHT_WOLVES', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 2,
      players: [a, b], roles: { A: 'WOLF', B: 'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['A', 'B']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null
    };
    (orch as any).store.put(game);
    expect(() => orch.wolvesChoose(game.id, 'A', 'B')).toThrow('cannot_target_lover');
  });

  it('lover cannot vote against their partner', () => {
    const a = mkP('A'); const b = mkP('B');
    a.loverId = 'B'; b.loverId = 'A';
    const game: Game = {
      id: 'G2', state: 'VOTE', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 2,
      players: [a, b], roles: { A: 'VILLAGER', B: 'WOLF' } as any,
      center: Array(2) as any,
      alive: new Set(['A', 'B']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null
    };
    (orch as any).store.put(game);
    expect(() => orch.voteCast(game.id, 'A', 'B')).toThrow('cannot_target_lover');
  });

  it('witch lover cannot poison their partner', () => {
    const a = mkP('A'); const b = mkP('B');
    a.loverId = 'B'; b.loverId = 'A';
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    const game: Game = {
      id: 'G3', state: 'NIGHT_WITCH', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 2,
      players: [a, b], roles: { A: 'WITCH', B: 'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['A', 'B']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null
    };
    (orch as any).store.put(game);
    expect(() => orch.witchDecision(game.id, 'A', false, 'B')).toThrow('cannot_target_lover');
  });

  it('hunter lover cannot shoot their partner', () => {
    const a = mkP('A'); const b = mkP('B');
    a.loverId = 'B'; b.loverId = 'A';
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    const game: Game = {
      id: 'G4', state: 'MORNING', createdAt: Date.now(), updatedAt: Date.now(), round: 1, maxPlayers: 2,
      players: [a, b], roles: { A: 'HUNTER', B: 'VILLAGER' } as any,
      center: Array(2) as any,
      alive: new Set(['A', 'B']), night: {}, inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {}, history: [], deadlines: {}, wolvesChoices: {}, morningAcks: new Set(), loversMode: null
    };
    (orch as any).store.put(game);
    (orch as any).askHunterTarget(game, 'A', ['A', 'B']);
    const pending = (orch as any).hunterAwaiting.get(`${game.id}:A`);
    expect(pending.alive).not.toContain('B');
    expect(() => orch.hunterShoot(game.id, 'A', 'B')).toThrow('cannot_target_lover');
  });
});
