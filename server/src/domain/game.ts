import { id } from './utils.js';
import { Game, Player, Variant } from './types.js';

export function createGame(variant: Variant): Game {
  return {
    id: id(),
    variant,
    state: 'LOBBY',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    round: 0,
    players: [],
    roles: {},
    alive: new Set<string>(),
    night: {},
    inventory: { witch: { healUsed: false, poisonUsed: false } },
    votes: {},
    history: [],
    deadlines: {},
    wolvesChoices: {}
  };
}

export function addPlayer(game: Game, p: Omit<Player, 'connected'|'lastSeen'|'isReady'>): Player {
  const player: Player = {
    ...p,
    isReady: false,
    connected: true,
    lastSeen: Date.now()
  };
  game.players.push(player);
  game.alive.add(player.id);
  game.updatedAt = Date.now();
  return player;
}
