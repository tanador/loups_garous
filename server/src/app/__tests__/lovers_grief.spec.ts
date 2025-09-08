import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket { constructor(public id: string) {} join(_r: string) {} emit() {} }
class FakeServer {
  public emits: { room: string | null, event: string, payload: any }[] = [];
  public sockets = { sockets: new Map<string, FakeSocket>() };
  to(room: string) { return { emit: (event: string, payload: any) => this.emits.push({ room, event, payload }) }; }
  emit(event: string, payload: any) { this.emits.push({ room: null, event, payload }); }
}
const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now() } as any);

describe('lovers grief resolution', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => { io = new FakeServer(); orch = new Orchestrator(io as any); });

  it('kills the partner immediately in morning recap when no hunter died directly', async () => {
    const a = mkP('A'); // villager lover
    const b = mkP('B'); // wolf lover
    const x = mkP('X'); // neutral villager
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    io.sockets.sockets.set(x.socketId, new FakeSocket(x.socketId));

    game = {
      id:'G1', state:'NIGHT_WITCH', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[a,b,x], roles:{ A:'VILLAGER', B:'WOLF', X:'VILLAGER' } as any,
      alive:new Set(['A','B','X']), night:{ attacked:'A' }, inventory:{ witch:{ healUsed:false, poisonUsed:false }}, votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:'MIXED_CAMPS',
    } as any;
    // lovers A <-> B
    (game.players.find(p=>p.id==='A') as any).loverId = 'B';
    (game.players.find(p=>p.id==='B') as any).loverId = 'A';
    (orch as any).store.put(game);

    await (orch as any).beginMorning(game);

    // Both A (attacked) and B (grief) should be dead at morning
    expect(game.alive.has('A')).toBe(false);
    expect(game.alive.has('B')).toBe(false);

    // The morning recap should list both deaths
    const recapEvt = io.emits.find(e => e.event === 'day:recap');
    const deaths: any[] = recapEvt?.payload?.deaths ?? [];
    const ids = new Set(deaths.map((d: any) => d.playerId));
    expect(ids.has('A')).toBe(true);
    expect(ids.has('B')).toBe(true);
  });
});

