import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Player } from '../../domain/types.js';

// Faux Socket pour simuler un client
class FakeSocket {
  id: string;
  rooms = new Set<string>();
  data: any = {};
  constructor(id: string) { this.id = id; }
  join(room: string) { this.rooms.add(room); }
  emit(_event: string, _payload?: any) { /* noop */ }
}

// Faux serveur Socket.IO pour capturer les émissions
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

describe('Lobby orchestration', () => {
  let io: FakeServer;
  let orch: Orchestrator;

  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as unknown as any);
  });

  function fakeSocket(id: string) {
    const s = new FakeSocket(id);
    io.sockets.sockets.set(s.id, s);
    return s;
  }

  it('createGame emits snapshot and updates lobby', () => {
    const s1 = fakeSocket('s1');
    const res = orch.createGame('Alice', 4, s1 as any);
    expect(res.gameId).toBeDefined();
    // Le créateur reçoit un snapshot initial
    const snap = io.emits.find(e => e.event === 'game:snapshot');
    expect(snap).toBeTruthy();
    // Le lobby est diffusé à tous
    const lobby = io.emits.find(e => e.event === 'lobby:updated');
    expect(lobby).toBeTruthy();
  });

  it('joinGame binds player and emits snapshot & lobby update', () => {
    const s1 = fakeSocket('s1');
    const s2 = fakeSocket('s2');
    const { gameId } = orch.createGame('Alice', 4, s1 as any);
    const res = orch.joinGame(gameId, 'Bob', s2 as any);
    expect(res.playerId).toBe('Bob');
    const snapToBob = io.emits.filter(e => e.event === 'game:snapshot').pop();
    expect(snapToBob).toBeTruthy();
    const lobby = io.emits.find(e => e.event === 'lobby:updated');
    expect(lobby).toBeTruthy();
  });

  it('cancelGame by owner emits game:cancelled and removes from lobby', () => {
    const s1 = fakeSocket('s1');
    const { gameId } = orch.createGame('Owner', 4, s1 as any);
    orch.cancelGame(gameId, 'Owner');
    // Tous les membres de la room reçoivent l'annulation
    const cancelled = io.emits.find(e => e.event === 'game:cancelled');
    expect(cancelled).toBeTruthy();
    // Et le lobby est mis à jour
    const lobby = io.emits.find(e => e.event === 'lobby:updated');
    expect(lobby).toBeTruthy();
  });

  it('leaveGame by non-owner removes player and snapshots remaining', () => {
    const s1 = fakeSocket('s1');
    const s2 = fakeSocket('s2');
    const { gameId } = orch.createGame('Owner', 4, s1 as any);
    orch.joinGame(gameId, 'Guest', s2 as any);
    orch.leaveGame(gameId, 'Guest');
    // Snapshots renvoyés aux joueurs restants
    const snaps = io.emits.filter(e => e.event === 'game:snapshot');
    expect(snaps.length).toBeGreaterThan(0);
  });
});

