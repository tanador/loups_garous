import { id } from './utils.js';
export function createGame(variant) {
    return {
        id: id(),
        variant,
        state: 'LOBBY',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        round: 0,
        players: [],
        roles: {},
        alive: new Set(),
        night: {},
        inventory: { witch: { healUsed: false, poisonUsed: false } },
        votes: {},
        history: [],
        deadlines: {},
        wolvesChoices: {}
    };
}
export function addPlayer(game, p) {
    const player = {
        ...p,
        isReady: false,
        connected: true,
        lastSeen: Date.now()
    };
    game.players.push(player);
    game.alive.add(player.id);
    return player;
}
//# sourceMappingURL=game.js.map