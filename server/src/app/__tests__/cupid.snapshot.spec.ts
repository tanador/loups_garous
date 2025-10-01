import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';

function makeIo() {
  const emit = vi.fn();
  return {
    to: vi.fn().mockReturnValue({ emit }),
    sockets: { sockets: new Map() },
    emit,
  } as any;
}

describe('cupid snapshot', () => {
  it('includes cupidTargets for cupid during NIGHT_CUPID snapshots', () => {
    const io = makeIo();
    const orch = new Orchestrator(io);
    const game = createGame(3);
    addPlayer(game, { id: 'Cupid', socketId: 'sock-cupid' });
    addPlayer(game, { id: 'Alice', socketId: 'sock-alice' });
    addPlayer(game, { id: 'Bob', socketId: 'sock-bob' });
    game.roles = {
      Cupid: 'CUPID',
      Alice: 'VILLAGER',
      Bob: 'WOLF',
    } as any;
    game.players.forEach((p) => (p.role = game.roles[p.id] as any));
    game.state = 'NIGHT_CUPID';

    (orch as any).sendSnapshot(game, 'Cupid');

    expect(io.to).toHaveBeenCalledWith('sock-cupid');
    expect(io.emit).toHaveBeenCalledWith('game:snapshot', expect.any(Object));
    const payload = io.emit.mock.calls[0][1];
    expect(payload.cupidTargets).toEqual([
      { id: 'Cupid' },
      { id: 'Alice' },
      { id: 'Bob' },
    ]);
  });
});
