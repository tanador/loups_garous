import type { Game, PendingDeath } from './types.js';

// Bus d'événements léger pour composer les règles du jeu.
export interface HunterShot { hunterId: string; targetId: string }

export interface EventPayloads {
  NightAction: { game: Game; deaths: Set<string> };
  DayAction: { game: Game };
  ResolvePhase: {
    game: Game;
    victim: string;
    queue: PendingDeath[];
    hunterShots: HunterShot[];
    askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined;
  };
}

type EventName = keyof EventPayloads;

type Handler<K extends EventName> = (payload: EventPayloads[K]) => any;

export class EventBus {
  private handlers: Partial<Record<EventName, Handler<EventName>[]>> = {};

  on<K extends EventName>(event: K, handler: Handler<K>): void {
    const list = (this.handlers[event] ??= []);
    (list as Handler<K>[]).push(handler);
  }

  async emit<K extends EventName>(event: K, payload: EventPayloads[K]): Promise<void> {
    const hs = this.handlers[event] as Handler<K>[] | undefined;
    if (!hs) return;
    for (const h of hs) await h(payload);
  }
}

export const bus = new EventBus();
export const Events = {
  NightAction: 'NightAction' as const,
  DayAction: 'DayAction' as const,
  ResolvePhase: 'ResolvePhase' as const,
};
