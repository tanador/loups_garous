import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
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

  it('requires new acknowledgments after hunter shot', async () => {
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

    // First recap acknowledgments
    orch.dayAck(g.id, 'B');
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    await new Promise(res => setTimeout(res, 0));
    expect(spy).toHaveBeenCalled();
    // Hunter shot should not advance state yet
    expect(g.state).toBe('MORNING');

    // Remaining alive players must acknowledge again
    orch.dayAck(g.id, 'C');
    orch.dayAck(g.id, 'D');
    await new Promise(res => setTimeout(res, 0));
    expect(g.state).toBe('VOTE');
  });
});
