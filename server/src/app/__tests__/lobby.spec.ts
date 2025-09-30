import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import { CONFIG } from '../timers.js';

const DEFAULT_LAUNCH_DELAY = CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE;

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
    CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE = DEFAULT_LAUNCH_DELAY;
    vi.useRealTimers();
  });

  beforeEach(() => {
    io = new FakeServer();
    orch = new Orchestrator(io as unknown as any);
  });

  afterEach(() => {
    CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE = DEFAULT_LAUNCH_DELAY;
    vi.useRealTimers();
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
  it('auto cancels lobby when owner stays disconnected', () => {
    vi.useFakeTimers();
    CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE = 3;
    const s1 = fakeSocket('s1');
    const { gameId } = orch.createGame('Alice', 4, s1 as any);
    expect(orch.listGames()).toHaveLength(1);
    orch.markDisconnected(s1 as any);
    vi.advanceTimersByTime(2999);
    expect(orch.listGames()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const cancelled = io.emits.filter(e => e.event === 'game:cancelled' && e.room === `room:${gameId}`);
    expect(cancelled.length).toBeGreaterThan(0);
    const lastPayload = cancelled[cancelled.length - 1]?.payload;
    expect(lastPayload).toEqual({ reason: 'timeout' });
    expect(orch.listGames()).toHaveLength(0);
  });

  it('keeps lobby when owner reconnects before delay', () => {
    vi.useFakeTimers();
    CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE = 3;
    const s1 = fakeSocket('s1');
    const { gameId } = orch.createGame('Alice', 4, s1 as any);
    expect(orch.listGames()).toHaveLength(1);
    orch.markDisconnected(s1 as any);
    vi.advanceTimersByTime(2000);
    const s1b = fakeSocket('s1b');
    orch.resume(gameId, 'Alice', s1b as any);
    vi.advanceTimersByTime(2000);
    const cancelled = io.emits.find(e => e.event === 'game:cancelled' && e.room === `room:${gameId}`);
    expect(cancelled).toBeFalsy();
    expect(orch.listGames()).toHaveLength(1);
  });

  it('does not cancel started games after owner disconnects', () => {
    vi.useFakeTimers();
    CONFIG.DELAIS_POUR_LANCEMENT_PARTIE_SECONDE = 1;
    const s1 = fakeSocket('s1');
    const { gameId } = orch.createGame('Solo', 3, s1 as any);
    const s2 = fakeSocket('s2');
    orch.joinGame(gameId, 'Bob', s2 as any);
    const s3 = fakeSocket('s3');
    orch.joinGame(gameId, 'Cara', s3 as any);
    expect(orch.listGames()).toHaveLength(0);
    orch.markDisconnected(s1 as any);
    vi.advanceTimersByTime(60000);
    const autoCancelled = io.emits.find(e => e.event === 'game:cancelled' && e.room === `room:${gameId}`);
    expect(autoCancelled).toBeFalsy();
  });


});
