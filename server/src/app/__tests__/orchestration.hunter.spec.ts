import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

// Minimal fake Socket.IO server to capture emissions without a real network
class FakeSocket {
  id: string;
  rooms = new Set<string>();
  data: any = {};
  constructor(id: string) { this.id = id; }
  join(room: string) { this.rooms.add(room); }
  emit(_event: string, _payload?: any) { /* client-directed emits ignored in tests */ }
}

class FakeServer {
  public emits: { room: string | null, event: string, payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) {
    return {
      emit: (event: string, payload: any) => {
        this.emits.push({ room, event, payload });
      },
    };
  }
  emit(event: string, payload: any) {
    this.emits.push({ room: null, event, payload });
  }
}

// Mock rules that depend on heavy runtime (bus). We only override the parts
// we need for this test; all other exports fall back to the real module.
vi.mock('../../domain/rules.js', async () => {
  const actual: any = await vi.importActual('../../domain/rules.js');
  return {
    ...actual,
    // Assign roles deterministically based on player nicknames
    assignRoles: (game: Game) => {
      const roles: Record<string, string> = {};
      for (const p of game.players) roles[p.id] = p.id as any; // nickname == role name
      game.roles = roles as any;
      game.players.forEach(p => (p.role = roles[p.id] as any));
    },
    // Force the hunter to die during the night resolution
    computeNightDeaths: async (_game: Game) => ['HUNTER'],
  };
});

describe('Orchestrator – hunter death should not end game before shot', () => {
  let io: FakeServer;
  let orch: Orchestrator;

  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as unknown as any);
  });

  function makePlayer(id: string): Player {
    const sock = new FakeSocket('sock:' + id);
    io.sockets.sockets.set(sock.id, sock);
    return {
      id,
      socketId: sock.id,
      isReady: true,
      connected: true,
      lastSeen: Date.now(),
    } as any;
  }

  it('delays victory evaluation until after the hunter shot is resolved', async () => {
    // Arrange a 4-player game: HUNTER, WITCH, WOLF, CUPID
    const game: Game = {
      id: 'G1',
      state: 'NIGHT_WITCH',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 1,
      maxPlayers: 4,
      players: [makePlayer('HUNTER'), makePlayer('WITCH'), makePlayer('WOLF'), makePlayer('CUPID')],
      roles: { HUNTER: 'HUNTER', WITCH: 'WITCH', WOLF: 'WOLF', CUPID: 'CUPID' } as any,
      center: Array(2) as any,
      alive: new Set(['HUNTER', 'WITCH', 'WOLF', 'CUPID']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set<string>(),
      loversMode: null,
    };

    // Register game in store for id-based methods
    (orch as any).store.put(game);
    // Act: go to morning with mocked death of HUNTER
    await (orch as any).beginMorning(game);

    // Assert: no game:ended emitted yet (hunter shot pending)
    const endedEarly = io.emits.find(e => e.event === 'game:ended');
    expect(endedEarly).toBeFalsy();

    // Survivors acknowledge recap to trigger handleMorningEnd
    orch.dayAck(game.id, 'WITCH');
    orch.dayAck(game.id, 'WOLF');
    orch.dayAck(game.id, 'CUPID');

    // Simulate hunter shooting the WITCH
    orch.hunterShoot(game.id, 'HUNTER', 'WITCH');

    // The orchestrator may proceed to a vote after acknowledgments
    // Acknowledge recap again to move forward, then ensure the game ends or proceeds deterministically
    orch.dayAck(game.id, 'WOLF');
    orch.dayAck(game.id, 'CUPID');
    // Ensure we are in a vote and cast a decisive vote
    ;(orch as any).beginVote(game);
    orch.voteCast(game.id, 'WOLF', 'CUPID');
    const ended = io.emits.find(e => e.event === 'game:ended');
    const beganVote = io.emits.find(e => e.event === 'vote:options');
    expect(!!ended || !!beganVote).toBeTruthy();
  });
  
  it('ends NIGHT_LOVERS early when both lovers acknowledge', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    const game: Game = {
      id: 'G2',
      state: 'NIGHT_LOVERS',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 1,
      maxPlayers: 4,
      players: [makePlayer('A'), makePlayer('B'), makePlayer('X'), makePlayer('Y')],
      roles: { A: 'VILLAGER', B: 'WOLF', X: 'WITCH', Y: 'CUPID' } as any,
      center: Array(2) as any,
      alive: new Set(['A', 'B', 'X', 'Y']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set<string>(),
      loversMode: 'MIXED_CAMPS',
    };
    // Pair lovers
    const pa = game.players.find(p => p.id === 'A')!; pa.loverId = 'B';
    const pb = game.players.find(p => p.id === 'B')!; pb.loverId = 'A';
    // Reset lovers acks store for the phase
    (game as any).loversAcks = new Set<string>();

    // Put in store and both lovers acknowledge
    (orch as any).store.put(game as any);
    orch.loversAck(game.id, 'A');
    expect(game.state).toBe('NIGHT_LOVERS');
    orch.loversAck(game.id, 'B');
    // With global sleep between phases, advance timers to pass the pause
    await vi.advanceTimersByTimeAsync(25_000);
    expect(['NIGHT_WOLVES','NIGHT_WITCH','MORNING','VOTE']).toContain(game.state as any);
    vi.useRealTimers();
  });
});
