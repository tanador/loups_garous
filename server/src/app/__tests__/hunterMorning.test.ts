import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { CONFIG } from '../timers.js';
import { createGame, addPlayer } from '../../domain/game.js';

function fakeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() }
  } as any;
}

describe('hunter death handling', () => {
  it('asks dead hunter to shoot after recap acknowledgments', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'WOLF';
    g.roles['D'] = 'VILLAGER';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    const spy = vi.spyOn(orch as any, 'askHunterTarget').mockResolvedValue('B');

    await (orch as any).beginMorning(g);
    expect(spy).not.toHaveBeenCalled();
    expect(g.alive.has('A')).toBe(false);
    expect(g.alive.has('B')).toBe(true);
    expect(g.state).toBe('MORNING');

    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    await new Promise(res => setTimeout(res, 0));
    expect(spy).toHaveBeenCalled();
    expect(g.alive.has('B')).toBe(false);
    // After the hunter shot, game should still wait for new acknowledgments
    expect(g.state).toBe('MORNING');
  });

  it('wakes the dead hunter once only survivors acknowledge and resumes the flow', async () => {
    const io = fakeIo();
    const orch = new Orchestrator(io);
    const g = createGame(5);

    const sockets = new Map<string, any>();
    (io as any).sockets.sockets = sockets;

    const players = ['A', 'B', 'C', 'D', 'E'];
    for (const id of players) {
      addPlayer(g, { id, socketId: 's' + id });
      const sock = {
        events: [] as { event: string; payload: any }[],
        emit(event: string, payload: any) {
          this.events.push({ event, payload });
          if (event === 'hunter:wake') {
            setTimeout(() => orch.hunterShoot(g.id, 'A', 'B'), 0);
          }
        },
        join() {},
      };
      sockets.set('s' + id, sock);
    }

    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'VILLAGER';
    g.roles['E'] = 'WOLF';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    await (orch as any).beginMorning(g);

    expect(g.alive.has('A')).toBe(false);
    expect((orch as any).pendingHunters.get(g.id)).toEqual(['A']);

    orch.dayAck(g.id, 'A');
    expect(g.morningAcks.size).toBe(0);

    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    expect(g.morningAcks.size).toBe(4);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(g.alive.has('B')).toBe(false);
    expect(g.morningAcks.size).toBe(0);
    expect((orch as any).pendingHunters.get(g.id)).toBeUndefined();

    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(g.state).toBe('VOTE');
    const recap = (orch as any).morningRecaps.get(g.id);
    expect(recap?.hunterKills).toContain('B');

    const hunterSock = sockets.get('sA');
    const wake = hunterSock.events.find((e: any) => e.event === 'hunter:wake');
    expect(wake).toBeDefined();
    expect(wake.payload.alive.map((p: any) => p.id)).toEqual(['B', 'C', 'D', 'E']);
  });

  it('requires new acknowledgments after hunter shot', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(5);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    addPlayer(g, { id: 'E', socketId: 'sE' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'WOLF';
    g.roles['D'] = 'VILLAGER';
    g.roles['E'] = 'VILLAGER';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    const spy = vi.spyOn(orch as any, 'askHunterTarget').mockResolvedValue('B');

    await (orch as any).beginMorning(g);

    // First recap acknowledgments
    orch.dayAck(g.id, 'A');
    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    await new Promise(res => setTimeout(res, 0));
    expect(spy).toHaveBeenCalled();
    // Hunter shot should not advance state yet
    expect(g.state).toBe('MORNING');

    // Remaining alive players must acknowledge again
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    await new Promise(res => setTimeout(res, 0));
    expect(g.state).toBe('VOTE');
  });

  it('prompts the hunter to shoot after dying of grief for a lover', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(5);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    addPlayer(g, { id: 'E', socketId: 'sE' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'WITCH';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'WOLF';
    g.roles['E'] = 'VILLAGER';
    g.players.find(p => p.id === 'A')!.loverId = 'B';
    g.players.find(p => p.id === 'B')!.loverId = 'A';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'B';

    const spy = vi
      .spyOn(orch as any, 'askHunterTarget')
      .mockImplementation(async (...rawArgs: unknown[]) => {
        const [, hunterId, alive] = rawArgs as [unknown, string, string[]];
        expect(hunterId).toBe('A');
        expect(alive).toEqual(['C', 'D', 'E']);
        return 'C';
      });

    await (orch as any).beginMorning(g);

    expect(spy).not.toHaveBeenCalled();
    expect(g.alive.has('A')).toBe(false);
    expect(g.alive.has('B')).toBe(false);
    expect((orch as any).pendingHunters.get(g.id)).toEqual(['A']);

    // Survivors acknowledge the recap
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    await new Promise(res => setTimeout(res, 0));

    expect(spy).toHaveBeenCalled();
  });

  it('still wakes the hunter if he dies directly but his lover survives', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(5);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    addPlayer(g, { id: 'E', socketId: 'sE' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'WITCH';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'VILLAGER';
    g.roles['E'] = 'WOLF';
    g.players.find(p => p.id === 'A')!.loverId = 'B';
    g.players.find(p => p.id === 'B')!.loverId = 'A';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = undefined;
    g.night.poisoned = 'A';

    const spy = vi
      .spyOn(orch as any, 'askHunterTarget')
      .mockImplementation(async (...rawArgs: unknown[]) => {
        const [, hunterId, alive] = rawArgs as [unknown, string, string[]];
        expect(hunterId).toBe('A');
        // Lover B should still be alive until grief resolves, so she is excluded from valid targets
        expect(alive).toEqual(['B', 'C', 'D', 'E']);
        return 'E';
      });

    await (orch as any).beginMorning(g);

    expect(spy).not.toHaveBeenCalled();
    expect(g.alive.has('A')).toBe(false);
    expect(g.alive.has('B')).toBe(true);
    // Grief should be deferred until after the hunter acts
    expect(g.deferredGrief).toEqual(['A']);

    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');
    await new Promise(res => setTimeout(res, 0));

    expect(spy).toHaveBeenCalled();
  });

  it('emits hunter:wake to the dead hunter when the lover dies first', async () => {
    const io = fakeIo();
    const orch = new Orchestrator(io);
    const g = createGame(5);
    const sockets = new Map<string, any>();
    const makePlayer = (id: string) => ({ id, socketId: 's' + id });
    const players = ['A', 'B', 'C', 'D', 'E'].map(makePlayer);
    for (const p of players) {
      addPlayer(g, p);
      sockets.set(p.socketId, {
        events: [] as { event: string; payload: any }[],
        emit(event: string, payload: any) {
          this.events.push({ event, payload });
          if (event === 'hunter:wake') {
            setTimeout(() => orch.hunterShoot(g.id, 'A', 'C'), 0);
          }
        },
        join() {},
      });
    }
    (io as any).sockets.sockets = sockets;

    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'WITCH';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'WOLF';
    g.roles['E'] = 'VILLAGER';
    g.players.find(p => p.id === 'A')!.loverId = 'B';
    g.players.find(p => p.id === 'B')!.loverId = 'A';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'B';

    await (orch as any).beginMorning(g);

    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    orch.dayAck(g.id, 'E');

    await new Promise(res => setTimeout(res, 0));

    const hunterSock = sockets.get('sA');
    const wake = hunterSock.events.find((e: any) => e.event === 'hunter:wake');
    expect(wake).toBeDefined();
    expect(wake.payload.alive.map((x: any) => x.id)).toEqual(['C', 'D', 'E']);
  });

  it('still resolves lover grief even if the hunter cannot shoot', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'WITCH';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'WOLF';
    g.players.find(p => p.id === 'A')!.loverId = 'B';
    g.players.find(p => p.id === 'B')!.loverId = 'A';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    vi.spyOn(orch as any, 'askHunterTarget').mockResolvedValue(undefined);

    await (orch as any).beginMorning(g);

    expect(g.alive.has('A')).toBe(false);
    expect(g.alive.has('B')).toBe(true);
    expect(g.deferredGrief).toEqual(['A']);

    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    await new Promise(res => setTimeout(res, 0));

    expect(g.alive.has('B')).toBe(false);
  });

  it('skips the hunter phase when no valid targets remain', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(2);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'WITCH';
    g.players.find(p => p.id === 'A')!.loverId = 'B';
    g.players.find(p => p.id === 'B')!.loverId = 'A';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'B';

    const spy = vi.spyOn(orch as any, 'askHunterTarget');

    await (orch as any).beginMorning(g);

    expect(spy).not.toHaveBeenCalled();
    expect(g.alive.size).toBe(0);
    // Force execution of the scheduled handler immediately
    await (orch as any).handleMorningEnd(g);
    expect((orch as any).pendingHunters.get(g.id)).toBeUndefined();
  });

  it('notifies the table while the hunter chooses a target', async () => {
    const roomEvents: { room: string; event: string; payload: any }[] = [];
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: any) => {
          roomEvents.push({ room, event, payload });
        },
      }),
      emit: () => {},
      sockets: { sockets: new Map<string, any>() },
    } as any;
    const orch = new Orchestrator(io);
    const g = createGame(4);
    const sockets = io.sockets.sockets as Map<string, any>;
    const players = ['A', 'B', 'C', 'D'];
    for (const id of players) {
      addPlayer(g, { id, socketId: 's' + id });
    }
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'WOLF';
    (orch as any).store.put(g);
    const hunterSocket = {
      events: [] as { event: string; payload: any }[],
      emit(event: string, payload: any) {
        this.events.push({ event, payload });
        if (event === 'hunter:wake') {
          setTimeout(() => orch.hunterShoot(g.id, 'A', 'B'), 0);
        }
      },
      join() {},
    };
    sockets.set('sA', hunterSocket);
    for (const id of players.slice(1)) {
      sockets.set('s' + id, { emit: () => {}, join: () => {} });
    }
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    await (orch as any).beginMorning(g);

    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pendingEvents = roomEvents.filter(
      (evt) => evt.room === 'room:' + g.id && evt.event === 'hunter:pending',
    );
    expect(pendingEvents[0]?.payload).toEqual({ active: true });
    expect(pendingEvents.find((evt) => evt.payload?.active === false)).toBeDefined();
  });

  it('auto-selects a target when the hunter delay expires', async () => {
    vi.useFakeTimers();
    const io = fakeIo();
    const orch = new Orchestrator(io);
    const g = createGame(4);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    addPlayer(g, { id: 'D', socketId: 'sD' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'VILLAGER';
    g.roles['D'] = 'WOLF';
    (orch as any).store.put(g);

    const sockets = (io as any).sockets.sockets as Map<string, any>;
    const hunterSocket = { emit: vi.fn() };
    sockets.set('sA', hunterSocket);

    const originalDelay = CONFIG.DELAI_CHASSEUR_SECONDES;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.6);

    CONFIG.DELAI_CHASSEUR_SECONDES = 0.5;

    try {
      const promise = (orch as any).askHunterTarget(g, 'A', ['A', 'B', 'C', 'D']);

      expect(hunterSocket.emit).toHaveBeenCalledWith('hunter:wake', {
        alive: [{ id: 'B' }, { id: 'C' }, { id: 'D' }],
      });

      await vi.runOnlyPendingTimersAsync();

      const target = await promise;

      expect(target).toBe('C');
      expect((orch as any).hunterAwaiting.size).toBe(0);
    } finally {
      CONFIG.DELAI_CHASSEUR_SECONDES = originalDelay;
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

});

