import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeServer {
  public emits: { room: string | null; event: string; payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  private roomMembers = new Map<string, Set<FakeSocket>>();

  register(socket: FakeSocket) {
    this.sockets.sockets.set(socket.id, socket);
    this.join(socket.id, socket);
  }

  join(room: string, socket: FakeSocket) {
    if (!this.roomMembers.has(room)) {
      this.roomMembers.set(room, new Set());
    }
    this.roomMembers.get(room)!.add(socket);
  }

  leave(room: string, socket: FakeSocket) {
    this.roomMembers.get(room)?.delete(socket);
  }

  to(room: string) {
    return {
      emit: (event: string, payload: any) => {
        this.emits.push({ room, event, payload });
        const listeners = this.roomMembers.get(room);
        if (!listeners) return;
        for (const sock of listeners) {
          sock.emit(event, payload);
        }
      },
    };
  }

  emit(event: string, payload: any) {
    this.emits.push({ room: null, event, payload });
  }
}

class FakeSocket {
  public rooms = new Set<string>();
  public events: { event: string; payload: any }[] = [];

  constructor(public id: string, private server: FakeServer) {
    this.rooms.add(id);
  }

  join(room: string) {
    this.rooms.add(room);
    this.server.join(room, this);
  }

  leave(room: string) {
    this.rooms.delete(room);
    this.server.leave(room, this);
  }

  emit(event: string, payload: any) {
    this.events.push({ event, payload });
  }
}

const mkPlayer = (id: string): Player =>
  ({
    id,
    socketId: `sock:${id}`,
    isReady: true,
    connected: true,
    lastSeen: Date.now(),
  } as unknown as Player);

// Ensure the final recap reaches players even if they lost membership
// in the global Socket.IO room (common when dead players reconnect late).
// The live bug reported by QA showed dead players missing the final summary,
// so this regression test forces that scenario by removing them from the room.
describe('end-game recap delivery', () => {
  it('sends game:ended to players no longer in the main room', () => {
    const io = new FakeServer();
    const orch = new Orchestrator(io as any);

    const alice = mkPlayer('Alice');
    const bob = mkPlayer('Bob');
    const claire = mkPlayer('Claire');

    const sockets = new Map<string, FakeSocket>([
      [alice.socketId, new FakeSocket(alice.socketId, io)],
      [bob.socketId, new FakeSocket(bob.socketId, io)],
      [claire.socketId, new FakeSocket(claire.socketId, io)],
    ]);
    for (const socket of sockets.values()) io.register(socket);

    const room = 'room:G1';
    sockets.get(alice.socketId)!.join(room);
    sockets.get(bob.socketId)!.join(room);
    // Claire (dead player) intentionally not in the room to mirror the bug.

    const game: Game = {
      id: 'G1',
      state: 'RESOLVE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      round: 3,
      maxPlayers: 3,
      players: [alice, bob, claire],
      roles: { Alice: 'VILLAGER', Bob: 'VILLAGER', Claire: 'WOLF' } as any,
      alive: new Set(['Alice', 'Bob']),
      night: {},
      inventory: { witch: { healUsed: false, poisonUsed: false } },
      votes: {},
      history: [],
      privateLog: [],
      deadlines: {},
      wolvesChoices: {},
      morningAcks: new Set(),
      loversMode: null,
      dayAcks: new Set(),
      pendingDeaths: [],
      deferredGrief: [],
      centerCards: [],
    } as unknown as Game;

    (orch as any).store.put(game);

    (orch as any).beginCheckEnd(game);

    const deadSocket = sockets.get(claire.socketId)!;
    const recapEvent = deadSocket.events.find((e) => e.event === 'game:ended');
    expect(recapEvent).toBeDefined();
    expect(recapEvent?.payload?.roles?.length).toBe(3);
    expect(recapEvent?.payload?.roles).toContainEqual({ playerId: 'Claire', role: 'WOLF' });
  });
});
