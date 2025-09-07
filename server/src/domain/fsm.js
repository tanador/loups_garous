import { Game, GameState } from './types.js';
/// Vérifie si un changement d'état est autorisé par la machine à états du jeu.
/// Les états doivent suivre l'ordre défini sauf cas particulier entre
/// `CHECK_END` et `NIGHT_WOLVES` qui forme une boucle lorsque la partie continue.
export function canTransition(_game, from, to) {
    const order = [
        'LOBBY', 'ROLES', 'NIGHT_WOLVES', 'NIGHT_WITCH', 'MORNING', 'VOTE', 'RESOLVE', 'CHECK_END', 'END'
    ];
    // Autorise la boucle de vérification vers une nouvelle nuit
    if (from === 'CHECK_END' && to === 'NIGHT_WOLVES')
        return true;
    return order.indexOf(to) === order.indexOf(from) + 1;
}
/// Applique le nouvel état sur la partie et met à jour le timestamp.
export function setState(game, to) {
    game.state = to;
    game.updatedAt = Date.now();
}
//# sourceMappingURL=fsm.js.map