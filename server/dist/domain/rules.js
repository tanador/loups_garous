import { secureShuffle } from './utils.js';
export function assignRoles(game) {
    const players = secureShuffle(game.players.map(p => p.id));
    const roles = game.variant === 'V1'
        ? ['WITCH', 'WOLF', 'WOLF']
        : ['WITCH', 'WOLF', 'VILLAGER'];
    const assigned = {};
    players.forEach((pid, idx) => (assigned[pid] = roles[idx]));
    game.roles = assigned;
    game.players.forEach(p => (p.role = assigned[p.id]));
}
export function wolvesOf(game) {
    return game.players.filter(p => game.roles[p.id] === 'WOLF').map(p => p.id);
}
export function witchId(game) {
    return game.players.find(p => game.roles[p.id] === 'WITCH')?.id;
}
export function alivePlayers(game) {
    return game.players.filter(p => game.alive.has(p.id)).map(p => p.id);
}
export function nonWolvesAlive(game) {
    return alivePlayers(game).filter(pid => game.roles[pid] !== 'WOLF');
}
export function computeNightDeaths(game) {
    const { attacked, saved, poisoned } = game.night;
    const deaths = new Set();
    if (attacked && attacked !== saved)
        deaths.add(attacked);
    if (poisoned)
        deaths.add(poisoned);
    // si attaqué et empoisonné le même joueur et sauvé, la potion de mort l'emporte
    // (sauvetage n'annule pas une autre cause de mort)
    return Array.from(deaths);
}
export function applyDeaths(game, deaths) {
    deaths.forEach(pid => game.alive.delete(pid));
}
export function computeVoteResult(game) {
    const tally = {};
    for (const pid of alivePlayers(game)) {
        const t = game.votes[pid];
        if (!t)
            continue;
        if (!game.alive.has(t))
            continue;
        tally[t] = (tally[t] ?? 0) + 1;
    }
    const entries = Object.entries(tally);
    if (entries.length === 0)
        return { eliminated: null, tally };
    entries.sort((a, b) => b[1] - a[1]);
    const [topId, topVotes] = entries[0];
    const tied = entries.filter(([, n]) => n === topVotes).length > 1;
    if (tied)
        return { eliminated: null, tally };
    return { eliminated: topId, tally };
}
export function winner(game) {
    const alive = alivePlayers(game);
    const wolves = alive.filter(pid => game.roles[pid] === 'WOLF').length;
    const nonWolves = alive.length - wolves;
    if (wolves === 0)
        return 'VILLAGE';
    if (nonWolves === 0)
        return 'WOLVES';
    return null;
}
export function targetsForWolves(game) {
    // les loups voient uniquement les non-loups vivants
    return nonWolvesAlive(game);
}
export function targetsForWitch(game) {
    // peut empoisonner n'importe qui encore en vie (y compris elle-même)
    return alivePlayers(game);
}
export function isConsensus(game) {
    const wolves = wolvesOf(game);
    if (wolves.length <= 1) {
        const t = wolves.length === 1 ? game.wolvesChoices[wolves[0]] : null;
        return t ? { consensus: true, target: t } : { consensus: false };
    }
    const choices = wolves.map(w => game.wolvesChoices[w]).filter(Boolean);
    if (choices.length < wolves.length)
        return { consensus: false };
    const allSame = choices.every(c => c === choices[0]);
    return allSame ? { consensus: true, target: choices[0] } : { consensus: false };
}
//# sourceMappingURL=rules.js.map