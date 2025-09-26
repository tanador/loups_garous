import type { Server } from "socket.io";
import type { GameStore } from "../store.js";
import type { Game } from "../../domain/types.js";

export type AckWaitlist = {
  expected: Set<PlayerId>;
  acknowledged: Set<PlayerId>;
};

export type OrchestratorHelpers = {
  sendSnapshot: (game: Game, playerId: string) => void;
  broadcastState: (game: Game) => void;
  emitLobbyUpdate: () => void;
  globalSleep: (game: Game, next: () => void) => void;
  beginNightThief: (game: Game) => void;
  beginNightCupid: (game: Game) => void;
  beginNightSeer: (game: Game) => void;
  beginNightWolves: (game: Game) => void;
  beginNightWitch: (game: Game) => void;
  beginMorning: (game: Game) => void;
};

export type GameId = string;
export type PlayerId = string;

export type OrchestratorLog = (
  gameId: string | undefined,
  phase: string,
  playerId: string | undefined,
  event: string,
  extra?: Record<string, unknown>,
) => void;

export type OrchestratorContext = {
  io: Server;
  store: GameStore;
  log: OrchestratorLog;
  timers: Map<string, NodeJS.Timeout>;
  waitlists: {
    acks: Map<string, AckWaitlist>;
    hunters: Map<GameId, Set<PlayerId>>;
  };
  helpers: OrchestratorHelpers;
};

function missing(name: keyof OrchestratorHelpers): never {
  throw new Error(`orchestrator helper '${name}' not configured`);
}

export function createContext(deps: {
  io: Server;
  store: GameStore;
  log: OrchestratorLog;
}): OrchestratorContext {
  return {
    io: deps.io,
    store: deps.store,
    log: deps.log,
    timers: new Map(),
    waitlists: {
      acks: new Map(),
      hunters: new Map(),
    },
    helpers: {
      sendSnapshot: () => missing("sendSnapshot"),
      broadcastState: () => missing("broadcastState"),
      emitLobbyUpdate: () => missing("emitLobbyUpdate"),
      globalSleep: () => missing("globalSleep"),
      beginNightThief: () => missing("beginNightThief"),
      beginNightCupid: () => missing("beginNightCupid"),
      beginNightSeer: () => missing("beginNightSeer"),
      beginNightWolves: () => missing("beginNightWolves"),
      beginNightWitch: () => missing("beginNightWitch"),
      beginMorning: () => missing("beginMorning"),
    },
  };
}


