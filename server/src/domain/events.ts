import type { Game } from './types.js';

export interface HunterShot { hunterId: string; targetId: string }

export interface EventPayloads {
  NightAction: { game: Game; deaths: Set<string> };
  DayAction: { game: Game };
  ResolvePhase: {
    game: Game;
    victim: string;
    queue: string[];
    hunterShots: HunterShot[];
    askHunter?: (hunterId: string, alive: string[]) => Promise<string | undefined> | string | undefined;
  };
}

type EventName = keyof EventPayloads;

type Handler<K extends EventName> = (payload: EventPayloads[K]) => any;

export class EventBus {
  private handlers: { [K in EventName]?: Handler<K>[] } = {};

  on<K extends EventName>(event: K, handler: Handler<K>): void {
    (this.handlers[event] ??= []).push(handler as any);
  }

  async emit<K extends EventName>(event: K, payload: EventPayloads[K]): Promise<void> {
    const hs = this.handlers[event];
    if (!hs) return;
    for (const h of hs) await h(payload as any);
  }
}

export const bus = new EventBus();
export const Events = {
  NightAction: 'NightAction' as const,
  DayAction: 'DayAction' as const,
  ResolvePhase: 'ResolvePhase' as const,
};
