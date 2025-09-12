import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket {
  public emits: { event: string; payload: any }[] = [];
  public rooms = new Set<string>();
  constructor(public id: string) {}
  join(room: string) { this.rooms.add(room); }
  emit(event: string, payload: any) { this.emits.push({ event, payload }); }
}

class FakeServer {
  public emits: { room: string | null; event: string; payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) {
    return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) };
  }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}

const mkPlayer = (id: string): Player => ({
  id,
  socketId: 'sock:' + id,
  isReady: false,
  connected: true,
  lastSeen: Date.now(),
} as any);

describe('Orchestrator thief integration', () => {
  let io: FakeServer;
  let orch: Orchestrator;

  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as any);
    (orch as any).globalSleep = (_g: Game, next: () => void) => next();
  });

  it('chains ROLES -> NIGHT_THIEF -> NIGHT_CUPID and lets thief play Cupid', () => {
    const T = mkPlayer('T');
    const A = mkPlayer('A');
    const B = mkPlayer('B');
    const tSock = new FakeSocket(T.socketId);
    io.sockets.sockets.set(tSock.id, tSock);
    io.sockets.sockets.set(A.socketId, new FakeSocket(A.socketId));
    io.sockets.sockets.set(B.socketId, new FakeSocket(B.socketId));
    const game: Game = {
      id: 'G1',
      state: 'ROLES',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 0,
      maxPlayers: 3,
      players: [T, A, B],
      roles: { T: 'THIEF', A: 'VILLAGER', B: 'VILLAGER' } as any,
      center: ['CUPID', 'VILLAGER'] as any,
      alive: new Set(['T', 'A', 'B']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set<string>(),
      loversMode: null,
    } as any;
    (orch as any).store.put(game);

    orch.playerReady(game.id, 'T');
    orch.playerReady(game.id, 'A');
    orch.playerReady(game.id, 'B');
    expect(game.state).toBe('NIGHT_THIEF');
    const wake = tSock.emits.find((e) => e.event === 'thief:wake');
    expect(wake).toBeTruthy();

    orch.thiefChoose(game.id, 'T', 0);
    expect(game.roles.T).toBe('CUPID');
    expect(game.center[0]).toBe('THIEF');
    expect(game.state).toBe('NIGHT_CUPID');
    const cupidWake = tSock.emits.find((e) => e.event === 'cupid:wake');
    expect(cupidWake).toBeTruthy();

    orch.cupidChoose(game.id, 'T', 'A', 'B');
    expect(game.players.find((p) => p.id === 'A')!.loverId).toBe('B');
    expect(game.state).toBe('NIGHT_LOVERS');
  });

  it('lets thief steal a wolf card and act during the wolves phase', () => {
    const T = mkPlayer('T');
    const W = mkPlayer('W');
    const V = mkPlayer('V');
    const tSock = new FakeSocket(T.socketId);
    const wSock = new FakeSocket(W.socketId);
    io.sockets.sockets.set(tSock.id, tSock);
    io.sockets.sockets.set(wSock.id, wSock);
    io.sockets.sockets.set(V.socketId, new FakeSocket(V.socketId));
    const game: Game = {
      id: 'G2',
      state: 'ROLES',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 0,
      maxPlayers: 3,
      players: [T, W, V],
      roles: { T: 'THIEF', W: 'WOLF', V: 'VILLAGER' } as any,
      center: ['WOLF', 'VILLAGER'] as any,
      alive: new Set(['T', 'W', 'V']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set<string>(),
      loversMode: null,
    } as any;
    (orch as any).store.put(game);

    orch.playerReady(game.id, 'T');
    orch.playerReady(game.id, 'W');
    orch.playerReady(game.id, 'V');
    expect(game.state).toBe('NIGHT_THIEF');

    orch.thiefChoose(game.id, 'T', 0);
    expect(game.roles.T).toBe('WOLF');
    expect(game.center[0]).toBe('THIEF');
    expect(game.state).toBe('NIGHT_WOLVES');
    expect(tSock.rooms.has('room:G2:wolves')).toBe(true);
    const wolvesWake = io.emits.find((e) => e.event === 'wolves:wake');
    expect(wolvesWake).toBeTruthy();

    orch.wolvesChoose(game.id, 'W', 'V');
    orch.wolvesChoose(game.id, 'T', 'V');
    expect(game.night.attacked).toBe('V');
  });
});

