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
  it('asks dead hunter to shoot after acknowledgements', async () => {
    const orch = new Orchestrator(fakeIo());
    const g = createGame(3);
    addPlayer(g, { id: 'A', socketId: 'sA' });
    addPlayer(g, { id: 'B', socketId: 'sB' });
    addPlayer(g, { id: 'C', socketId: 'sC' });
    g.roles['A'] = 'HUNTER';
    g.roles['B'] = 'VILLAGER';
    g.roles['C'] = 'WOLF';
    (orch as any).store.put(g);
    g.state = 'NIGHT_WITCH';
    g.night.attacked = 'A';

    // stub hunter target selection to avoid socket interactions
    const spy = vi.spyOn(orch as any, 'askHunterTarget').mockResolvedValue(undefined);

    await (orch as any).beginMorning(g);
    expect(g.state).toBe('MORNING');
    expect(g.huntersToShoot).toEqual(['A']);

    // only one alive villager acks: hunter should not be asked yet
    orch.dayAck(g.id, 'B');
    expect(spy).not.toHaveBeenCalled();
    expect(g.state).toBe('MORNING');

    // second alive player acks: still waiting for hunter
    orch.dayAck(g.id, 'C');
    expect(spy).not.toHaveBeenCalled();
    expect(g.state).toBe('MORNING');

    // hunter acks
    orch.dayAck(g.id, 'A');
    await new Promise(res => setTimeout(res, 0));
    expect(spy).toHaveBeenCalled();
    expect(g.state).toBe('VOTE');
  });
});
