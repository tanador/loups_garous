export function canTransition(_game, from, to) {
    const order = [
        'LOBBY', 'ROLES', 'NIGHT_WOLVES', 'NIGHT_WITCH', 'MORNING', 'VOTE', 'RESOLVE', 'CHECK_END', 'END'
    ];
    // allow loops from CHECK_END -> NIGHT_WOLVES
    if (from === 'CHECK_END' && to === 'NIGHT_WOLVES')
        return true;
    return order.indexOf(to) === order.indexOf(from) + 1;
}
export function setState(game, to) {
    game.state = to;
    game.updatedAt = Date.now();
}
//# sourceMappingURL=fsm.js.map