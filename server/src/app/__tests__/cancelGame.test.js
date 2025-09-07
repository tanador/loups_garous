import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { createGame, addPlayer } from '../../domain/game.js';
function fakeIo(events) {
    return {
        to: (room) => ({ emit: (ev, data) => events.push({ room, ev, data }) }),
        emit: (ev, data) => events.push({ room: null, ev, data }),
        sockets: { sockets: new Map() }
    };
}
describe('cancel game', () => {
    it('removes game and notifies players', () => {
        const events = [];
        const orch = new Orchestrator(fakeIo(events));
        const g = createGame(3);
        addPlayer(g, { id: 'A', socketId: 'sA' });
        addPlayer(g, { id: 'B', socketId: 'sB' });
        orch.store.put(g);
        orch.cancelGame(g.id, 'A');
        expect(orch.store.get(g.id)).toBeUndefined();
        expect(events.find(e => e.ev === 'game:cancelled')).toBeTruthy();
        expect(events.find(e => e.ev === 'lobby:updated')).toBeTruthy();
    });
});
//# sourceMappingURL=cancelGame.test.js.map