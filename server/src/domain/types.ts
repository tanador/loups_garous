import type { Role } from './roles/index.js';

export type CoreGameState =
  | 'LOBBY'
  | 'ROLES'
  | 'NIGHT_CUPID'
  | 'NIGHT_WOLVES'
  | 'NIGHT_WITCH'
  | 'MORNING'
  | 'VOTE'
  | 'RESOLVE'
  | 'CHECK_END'
  | 'END';

// Allow external modules to declare additional game phases dynamically.
// The type keeps known states for editor autocompletion but accepts any
// string so that new phases can be registered at runtime.
export type GameState = CoreGameState | (string & {});

export type { Role };

export interface Player {
  id: string; // player's nickname (unique)
  socketId: string;
  role?: Role;
  isReady: boolean;
  connected: boolean;
  lastSeen: number;
  // Lover link (Cupidon). If set, must be symmetric with the partner's loverId
  loverId?: string;
}

export interface NightState {
  attacked?: string; // cible des loups si consensus
  saved?: string;    // joueur sauvé par la potion de vie
  poisoned?: string; // cible de la potion de mort
}

export interface HistoryEvent {
  round: number;
  night: { attacked?: string; saved?: string; poisoned?: string; deaths: string[] };
  day?: { eliminated?: string | null; tally: Record<string, number> };
}

// Coarse game phase (independent from fine-grained GameState)
export type CoarsePhase = 'SETUP' | 'NIGHT' | 'DAY' | 'VOTE' | 'RESOLUTION';

// Lovers pairing mode
export type LoversMode = 'SAME_CAMP' | 'MIXED_CAMPS' | null;

export interface PendingDeath {
  cause: string; // e.g. 'WOLVES' | 'WITCH' | 'HUNTER' | 'VOTE' | 'LOVERS'
  victimId: string;
}

export interface Game {
  id: string;
  state: GameState;
  phase?: CoarsePhase; // optional: derived from state, initialized in createGame
  createdAt: number;
  updatedAt: number;
  round: number;
  maxPlayers: number;
  players: Player[];
  roles: Record<string, Role>; // nickname -> role
  alive: Set<string>; // set of nicknames
  night: NightState;
  inventory: { witch: { healUsed: boolean; poisonUsed: boolean } };
  votes: Record<string, string>; // nickname -> target nickname
  history: HistoryEvent[];
  deadlines?: { phaseEndsAt?: number };
  wolvesChoices: Record<string, string | null>; // current choice per wolf (by nickname)
  morningAcks: Set<string>;
  loversMode?: LoversMode;
  pendingDeaths?: PendingDeath[]; // FIFO queue for resolution helpers
  deferredGrief?: string[]; // victims whose lovers should later die of grief
}
