import { id } from './utils.js';
import { Game, Player, Role } from './types.js';
/// Crée une nouvelle partie avec les valeurs par défaut.
/// Un identifiant unique est généré pour pouvoir rejoindre la partie.
export function createGame(maxPlayers) {
    return {
        id: id(),
        state: 'LOBBY',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        round: 0,
        maxPlayers,
        players: [],
        roles: {},
        alive: new Set(),
        night: {},
        inventory: { witch: { healUsed: false, poisonUsed: false } },
        votes: {},
        history: [],
        deadlines: {},
        wolvesChoices: {},
        morningAcks: new Set()
    };
}
/// Normalise un pseudonyme pour les comparaisons (trim + lowercase).
function normalize(n) {
    return n.trim().toLowerCase();
}
/// Ajoute un joueur dans la partie en s'assurant que son pseudonyme est unique.
/// Retourne l'objet joueur créé.
export function addPlayer(game, p) {
    const id = p.id.trim();
    // Vérifie qu'aucun autre joueur n'a déjà ce pseudo (insensible à la casse)
    if (game.players.some(existing => normalize(existing.id) === normalize(id))) {
        throw new Error('nickname_taken');
    }
    const player = {
        id,
        socketId: p.socketId,
        role: p.role,
        isReady: false,
        connected: true,
        lastSeen: Date.now()
    };
    game.players.push(player);
    game.alive.add(player.id);
    game.updatedAt = Date.now();
    return player;
}
/// Retire totalement un joueur de la partie et nettoie toutes ses références
/// (rôles, votes, acknowledgements...).
export function removePlayer(game, playerId) {
    game.players = game.players.filter(p => p.id !== playerId);
    game.alive.delete(playerId);
    delete game.roles[playerId];
    delete game.wolvesChoices[playerId];
    delete game.votes[playerId];
    game.morningAcks.delete(playerId);
    game.updatedAt = Date.now();
}
//# sourceMappingURL=game.js.map