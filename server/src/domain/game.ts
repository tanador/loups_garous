/**
 * Low-level helpers that manipulate the in-memory state of a single match.
 *
 * Terminology for newcomers to the Loup Garou board game:
 *   - A "game" is a complete session that goes through lobby -> night/day -> end.
 *   - Each "player" is identified by a nickname and receives a secret role
 *     (Villager, Wolf, Seer, etc.).
 *   - "Alive" players can still act and vote. When a player dies we keep them
 *     in the `players` array for history but remove them from the `alive` set.
 */
import { id } from './utils.js';
import { Game, Player, Role } from './types.js';

/**
 * Create a new empty game container.
 *
 * The orchestrator later fills this structure with lobby members, assigns
 * roles and moves the `state` machine forward. We pre-create a few helpers to
 * make later updates cheaper (e.g. Set for alive players, maps for votes).
 */
export function createGame(maxPlayers: number): Game {
  return {
    id: id(),
    state: 'LOBBY',
    phase: 'SETUP',
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
    privateLog: [],
    deadlines: {},
    wolvesChoices: {},
    dayAcks: new Set<string>(),
    morningAcks: new Set<string>(),
    loversMode: null,
    pendingDeaths: [],
    hunterPending: false,
    deferredGrief: [],
    centerCards: [],
  };
}

// Normalise a nickname so we can compare ids without worrying about accents or case.
function normalize(n: string) {
  return n.trim().toLowerCase();
}

/**
 * Register a player in the lobby.
 *
 * Throws when the nickname is already taken because the board game requires
 * unique identities: the client uses this to prompt the user to pick another
 * pseudo. We keep the raw player object inside the game so the orchestrator can
 * track readiness, socket connection and role assignment later on.
 */
export function addPlayer(
  game: Game,
  p: { id: string; socketId: string; role?: Role },
): Player {
  const nickname = p.id.trim();
  if (nickname.length === 0) {
    throw new Error('nickname_required');
  }

  if (game.players.some((existing) => normalize(existing.id) === normalize(nickname))) {
    throw new Error('nickname_taken');
  }

  const player: Player = {
    id: nickname,
    socketId: p.socketId,
    role: p.role,
    isReady: false,
    connected: true,
    lastSeen: Date.now(),
    privateLog: [],
  };

  game.players.push(player);
  game.alive.add(player.id);
  game.updatedAt = Date.now();
  return player;
}

/**
 * Remove a player entirely from the game container.
 *
 * We clear every related structure (votes, wolves choices, lovers links) so the
 * orchestrator does not have to worry about stale references during the next
 * phase. This is typically called when someone leaves the lobby or disconnects
 * for too long during a live match.
 */
export function removePlayer(game: Game, playerId: string): void {
  game.players = game.players.filter((p) => p.id !== playerId);
  game.alive.delete(playerId);
  delete game.roles[playerId];
  delete game.wolvesChoices[playerId];
  delete game.votes[playerId];
  game.dayAcks?.delete(playerId);
  game.morningAcks.delete(playerId);
  game.updatedAt = Date.now();
}
