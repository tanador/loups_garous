import { describe, it, expect } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { assignRoles, computeNightDeaths, applyDeaths, winner } from '../rules.js';
function seedGameV1() {
    const g = createGame('V1');
    const a = addPlayer(g, { id: 'A', nickname: 'A', socketId: 'sA' });
    const b = addPlayer(g, { id: 'B', nickname: 'B', socketId: 'sB' });
    const c = addPlayer(g, { id: 'C', nickname: 'C', socketId: 'sC' });
    assignRoles(g);
    return g;
}
describe('night resolution', () => {
    it('heal cancels wolves attack but poison kills target', () => {
        const g = seedGameV1();
        g.night.attacked = 'A';
        g.night.saved = 'A';
        g.night.poisoned = 'B';
        const deaths = computeNightDeaths(g);
        expect(deaths.sort()).toEqual(['B']);
        applyDeaths(g, deaths);
        expect(g.alive.has('A')).toBe(true);
        expect(g.alive.has('B')).toBe(false);
    });
});
describe('winner checks', () => {
    it('village wins when no wolves', () => {
        const g = seedGameV1();
        // kill wolves
        for (const [pid, role] of Object.entries(g.roles)) {
            if (role === 'WOLF')
                g.alive.delete(pid);
        }
        expect(winner(g)).toBe('VILLAGE');
    });
});
//# sourceMappingURL=rules.test.js.map