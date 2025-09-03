export type GameState =
  | 'LOBBY' | 'ROLES' | 'NIGHT_WOLVES' | 'NIGHT_WITCH'
  | 'MORNING' | 'VOTE' | 'RESOLVE' | 'CHECK_END' | 'END';

export type Role = 'WOLF' | 'WITCH' | 'VILLAGER';
export type Variant = 'V1' | 'V2';

export interface Player {
  id: string; // player's nickname (unique)
  socketId: string;
  role?: Role;
  isReady: boolean;
  connected: boolean;
  lastSeen: number;
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

export interface Game {
  id: string;
  variant: Variant;
  state: GameState;
  createdAt: number;
  updatedAt: number;
  round: number;
  players: Player[];
  roles: Record<string, Role>; // nickname -> role
  alive: Set<string>; // set of nicknames
  night: NightState;
  inventory: { witch: { healUsed: boolean; poisonUsed: boolean } };
  votes: Record<string, string | null>; // nickname -> target nickname|null
  history: HistoryEvent[];
  deadlines?: { phaseEndsAt?: number };
  wolvesChoices: Record<string, string | null>; // current choice per wolf (by nickname)
}
