/**
 * Shared TypeScript types that describe the in-memory shape of a match.
 *
 * Reading tip for beginners:
 *   - Loup Garou is a hidden-role game. Each player receives a secret role such
 *     as "Wolf" or "Seer". Wolves try to eliminate villagers, villagers try to
 *     spot and execute wolves during the day.
 *   - The server keeps everything inside a single `Game` object so the
 *     orchestrator can mutate it while the finite state machine advances.
 *   - Tests use these types to build fixtures and to assert that rules behave as
 *     expected (e.g. hunters can shoot after they die at night).
 */
import type { Role } from './roles/index.js';

export type CoreGameState =
  | 'LOBBY'
  | 'ROLES'
  | 'NIGHT_CUPID'
  | 'NIGHT_LOVERS'
  | 'NIGHT_THIEF'
  | 'NIGHT_SEER'
  | 'NIGHT_WOLVES'
  | 'NIGHT_WITCH'
  | 'MORNING'
  | 'VOTE'
  | 'RESOLVE'
  | 'CHECK_END'
  | 'END';

// Allow extending the FSM from role modules. Keeping `string & {}` helps TS
// preserve literal types while still accepting unknown phases.
export type GameState = CoreGameState | (string & {});

export type { Role };

export interface Player {
  /** Nickname chosen by the player; acts as primary identifier. */
  id: string;
  /** Socket.IO id (changes if the player reconnects). */
  socketId: string;
  /** Secret role assigned during the ROLES phase. */
  role?: Role;
  /** Ready flag used in the lobby. */
  isReady: boolean;
  /** Connection flag, toggled when the socket disconnects/reconnects. */
  connected: boolean;
  /** Timestamp of the last heartbeat from the client. */
  lastSeen: number;
  /** Lover link created by Cupid. Always symmetric. */
  loverId?: string;
  /**
   * Per-player private log. We push entries that are only visible to the owner
   * on the client (seer visions, hunter prompts, etc.).
   */
  privateLog: { type: string; [k: string]: unknown }[];
}

export interface NightState {
  attacked?: string; // Target chosen by the wolves when they agree.
  saved?: string;    // Player rescued by the witch.
  poisoned?: string; // Player killed by the witch.
}

export interface HistoryEvent {
  /** Incremental night number (starts at 1 after the first night). */
  round: number;
  night: { attacked?: string; saved?: string; poisoned?: string; deaths: string[] };
  day?: { eliminated?: string | null; tally: Record<string, number> };
  /** Optional audit events (seer peeks, hunter shots, etc.). */
  events?: { type: string; [k: string]: unknown }[];
}

// High-level grouping of the FSM, mostly for UI.
export type CoarsePhase = 'SETUP' | 'NIGHT' | 'DAY' | 'VOTE' | 'RESOLUTION';

export type LoversMode = 'SAME_CAMP' | 'MIXED_CAMPS' | null;

export interface PendingDeath {
  /** Source of the death (WOLVES, WITCH, HUNTER, VOTE, LOVERS...). */
  cause: string;
  victimId: string;
}

export interface Game {
  id: string;
  state: GameState;
  /** Coarse phase, useful for the UI to colour screens. */
  phase?: CoarsePhase;
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
   * Set of acknowledgements for the daytime recap (after village vote).
   * Cleared when the recap is emitted and used only during RESOLVE.
   */
  dayAcks?: Set<string>;
  /**
   * If a first vote ends in a tie, store the eligible player ids for the
   * subsequent revote. Only these players can be targeted while this array is
   * defined.
   */
  revoteTargets?: string[];
  /** Number of the current revote round (1 for first revote). */
  revoteRound?: number;
  history: HistoryEvent[];
  privateLog?: any[];
  deadlines?: { phaseEndsAt?: number };
  wolvesChoices: Record<string, string | null>;
  morningAcks: Set<string>;
  loversMode?: LoversMode;
  pendingDeaths?: PendingDeath[];
  deferredGrief?: string[];
  /** Two hidden cards when the Thief is in the deck (official rule). */
  centerCards?: Role[];
}
