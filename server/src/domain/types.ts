import type { Role } from './roles/index.js';

// Déclarations de types pour l'état de jeu et les entités côté serveur.
export type CoreGameState =
  | 'LOBBY'
  | 'ROLES'
  | 'NIGHT_CUPID'
  | 'NIGHT_LOVERS'
  // Phase où la voyante choisit une cible à sonder.
  | 'NIGHT_SEER'
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
  /**
   * Per-player private event log.
   * Stores audit events visible only to that player (e.g., seer peeks).
   */
  privateLog: { type: string; [k: string]: unknown }[];
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
  /** Optional list of audit events for the round (e.g., seer peeks). */
  events?: { type: string; [k: string]: unknown }[];
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
  /**
   * If a first vote ends in a tie, store the eligible player ids for the
   * subsequent revote. Only these players can be targeted while this array
   * is defined.
   */
  revoteTargets?: string[];
  /**
   * Number of the current revote round (1 for first revote). Undefined when
   * no revote is ongoing.
   */
  revoteRound?: number;
  history: HistoryEvent[];
  privateLog?: any[];
  deadlines?: { phaseEndsAt?: number };
  wolvesChoices: Record<string, string | null>; // current choice per wolf (by nickname)
  morningAcks: Set<string>;
  loversMode?: LoversMode;
  pendingDeaths?: PendingDeath[]; // FIFO queue for resolution helpers
  deferredGrief?: string[]; // victims whose lovers should later die of grief
  // Two face-down center cards (roles) used when THIEF is in the deck
  centerCards?: Role[];
}




