import { id } from './utils.js';
import { Game, Player, Role } from './types.js';

export function createGame(maxPlayers: number): Game {
  return {
    id: id(),
    state: 'LOBBY',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    round: 0,
    maxPlayers,
    players: [],
    roles: {},
    alive: new Set<string>(),
    night: {},
    inventory: { witch: { healUsed: false, poisonUsed: false } },
    votes: {},
    history: [],
    deadlines: {},
    wolvesChoices: {},
    morningAcks: new Set<string>()
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

export function removePlayer(game: Game, playerId: string): void {
  game.players = game.players.filter(p => p.id !== playerId);
  game.alive.delete(playerId);
  delete game.roles[playerId];
  delete game.wolvesChoices[playerId];
  delete game.votes[playerId];
  game.morningAcks.delete(playerId);
  game.updatedAt = Date.now();
}
