import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket {
  id: string;
  rooms = new Set<string>();
  data: any = {};
  events: { event: string; payload: any }[] = [];
  constructor(id: string) {
    this.id = id;
  }
  join(room: string) {
    this.rooms.add(room);
  }
  emit(event: string, payload?: any) {
    this.events.push({ event, payload });
  }
}

class FakeServer {
  public emits: { room: string | null; event: string; payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) {
    return {
      emit: (event: string, payload: any) => {
        this.emits.push({ room, event, payload });
        if (room.startsWith('sock:')) {
          const target = this.sockets.sockets.get(room);
          target?.emit(event, payload);
        }
      },
    };
  }
  emit(event: string, payload: any) {
    this.emits.push({ room: null, event, payload });
  }
}

function makePlayer(io: FakeServer, id: string): Player {
  const socket = new FakeSocket(`sock:${id}`);
  io.sockets.sockets.set(socket.id, socket);
  return {
    id,
    socketId: socket.id,
    role: undefined,
    isReady: true,
    connected: true,
    lastSeen: Date.now(),
    privateLog: [],
  };
}

function baseGame(players: Player[]): Game {
  return {
    id: 'g:test',
    state: 'NIGHT_THIEF',
    phase: 'NIGHT',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    round: 0,
    maxPlayers: players.length,
    players,
    roles: Object.fromEntries(players.map((p) => [p.id, p.role ?? 'VILLAGER'])) as any,
    alive: new Set(players.map((p) => p.id)),
    night: {},
    inventory: { witch: { healUsed: false, poisonUsed: false } },
    votes: {},
    history: [],
    deadlines: {},
    wolvesChoices: {},
    morningAcks: new Set<string>(),
    loversMode: null,
  };
}

describe('Night role wake events', () => {
  let io: FakeServer;
  let orch: Orchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    io = new FakeServer();
    orch = new Orchestrator(io as unknown as any);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('emits cupid:wake with alive candidates', () => {
    const cupid = makePlayer(io, 'CUPID');
    const alice = makePlayer(io, 'ALICE');
    const bob = makePlayer(io, 'BOB');
    cupid.role = 'CUPID' as any;
    alice.role = 'VILLAGER' as any;
    bob.role = 'WOLF' as any;
    const game = baseGame([cupid, alice, bob]);
    game.roles = { CUPID: 'CUPID', ALICE: 'VILLAGER', BOB: 'WOLF' } as any;
    (orch as any).store.put(game);

    (orch as any).beginNightCupid(game);

    const cupidSocket = io.sockets.sockets.get(cupid.socketId)!;
    const wake = cupidSocket.events.find((e) => e.event === 'cupid:wake');
    expect(wake).toBeDefined();
    expect(wake?.payload?.alive).toEqual([
      { id: 'CUPID' },
      { id: 'ALICE' },
      { id: 'BOB' },
    ]);
  });

  it('emits witch:wake with current options', () => {
    const witch = makePlayer(io, 'WITCH');
    const villager = makePlayer(io, 'VILLAGER');
    const wolf = makePlayer(io, 'WOLF');
    witch.role = 'WITCH' as any;
    villager.role = 'VILLAGER' as any;
    wolf.role = 'WOLF' as any;
    const game = baseGame([witch, villager, wolf]);
    game.roles = { WITCH: 'WITCH', VILLAGER: 'VILLAGER', WOLF: 'WOLF' } as any;
    game.night.attacked = 'VILLAGER';
    game.state = 'NIGHT_WOLVES';
    (orch as any).store.put(game);

    (orch as any).beginNightWitch(game);

    const witchSocket = io.sockets.sockets.get(witch.socketId)!;
    const snapshot = witchSocket.events.find((e) => e.event === 'game:snapshot');
    expect(snapshot?.payload?.witchWake).toMatchObject({
      attacked: 'VILLAGER',
      healAvailable: true,
      poisonAvailable: true,
    });
    expect(snapshot?.payload?.witchWake?.alive).toEqual([
      { id: 'VILLAGER' },
      { id: 'WOLF' },
    ]);

    const wake = witchSocket.events.find((e) => e.event === 'witch:wake');
    expect(wake).toBeDefined();
    expect(wake?.payload).toMatchObject({
      attacked: 'VILLAGER',
      healAvailable: true,
      poisonAvailable: true,
    });
    expect(wake?.payload?.alive).toEqual([
      { id: 'VILLAGER' },
      { id: 'WOLF' },
    ]);
  });

  it('updates player socket context to deliver night wake events', () => {
    const cupid = makePlayer(io, 'CUPID');
    const alice = makePlayer(io, 'ALICE');
    const bob = makePlayer(io, 'BOB');
    cupid.role = 'CUPID' as any;
    alice.role = 'VILLAGER' as any;
    bob.role = 'WOLF' as any;
    const game = baseGame([cupid, alice, bob]);
    game.roles = { CUPID: 'CUPID', ALICE: 'VILLAGER', BOB: 'WOLF' } as any;
    (orch as any).store.put(game);

    const newSocket = new FakeSocket('sock:new');
    io.sockets.sockets.set(newSocket.id, newSocket);

    orch.setSocketContext(game.id, 'CUPID', newSocket as any);

    (orch as any).beginNightCupid(game);

    const wake = newSocket.events.find((e) => e.event === 'cupid:wake');
    expect(wake).toBeDefined();
    expect(wake?.payload?.alive).toEqual([
      { id: 'CUPID' },
      { id: 'ALICE' },
      { id: 'BOB' },
    ]);

    const originalSocket = io.sockets.sockets.get('sock:CUPID');
    expect(originalSocket?.events.find((e) => e.event === 'cupid:wake')).toBeUndefined();
  });
});
