import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';
function fakeIo() {
    return {
        to: () => ({ emit: () => { } }),
        emit: () => { },
        sockets: { sockets: new Map() }
    };
}
describe('night death resolution', () => {
    it('sends snapshots and removes killed players in morning', async () => {
        const orch = new Orchestrator(fakeIo());
        const g = createGame(3);
        addPlayer(g, { id: 'Wolf', socketId: 'sW' });
        addPlayer(g, { id: 'Witch', socketId: 'sWi' });
        addPlayer(g, { id: 'Villager', socketId: 'sV' });
        g.roles = { Wolf: 'WOLF', Witch: 'WITCH', Villager: 'VILLAGER' };
        g.players.forEach(p => (p.role = g.roles[p.id]));
        orch.store.put(g);
        g.state = 'NIGHT_WITCH';
        g.night.attacked = 'Villager';
        const spy = vi.spyOn(orch, 'sendSnapshot');
        await orch.beginMorning(g);
        expect(g.alive.has('Villager')).toBe(false);
        expect(spy).toHaveBeenCalledTimes(3);
    });
});
//# sourceMappingURL=nightDeath.test.js.map