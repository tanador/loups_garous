import { id } from './utils.js';
import { Game, Player, Variant, Role } from './types.js';

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

function normalize(n: string) {
  return n.trim().toLowerCase();
}

export function addPlayer(game: Game, p: { id: string; socketId: string; role?: Role }): Player {
  const id = p.id.trim();
  if (game.players.some(existing => normalize(existing.id) === normalize(id))) {
    throw new Error('nickname_taken');
  }
  const player: Player = {
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
