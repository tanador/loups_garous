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
describe('leave game', () => {
    it('removes player and updates lobby', () => {
        const events = [];
        const orch = new Orchestrator(fakeIo(events));
        const g = createGame(3);
        addPlayer(g, { id: 'A', socketId: 'sA' });
        addPlayer(g, { id: 'B', socketId: 'sB' });
        orch.store.put(g);
        orch.leaveGame(g.id, 'B');
        const updated = orch.store.get(g.id);
        expect(updated.players.map((p) => p.id)).toEqual(['A']);
        expect(events.find(e => e.ev === 'lobby:updated')).toBeTruthy();
        expect(events.find(e => e.ev === 'game:snapshot')).toBeTruthy();
    });
    it('cancels game if owner leaves', () => {
        const events = [];
        const orch = new Orchestrator(fakeIo(events));
        const g = createGame(3);
        addPlayer(g, { id: 'A', socketId: 'sA' });
        addPlayer(g, { id: 'B', socketId: 'sB' });
        orch.store.put(g);
        orch.leaveGame(g.id, 'A');
        expect(orch.store.get(g.id)).toBeUndefined();
        expect(events.find(e => e.ev === 'game:cancelled')).toBeTruthy();
    });
});
//# sourceMappingURL=leaveGame.test.js.map