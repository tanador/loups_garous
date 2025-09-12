import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../app/orchestrator.js';
import type { Game, Player } from '../../domain/types.js';

class FakeSocket { constructor(public id: string) {} join(_r: string) {} emit() {} }
class FakeServer { public sockets = { sockets: new Map<string, FakeSocket>() }; to(){return{emit(){}}} emit(){} }
const mkP = (id: string): Player => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now() } as any);

describe('Witch decisions validations', () => {
  let io: FakeServer; let orch: Orchestrator; let game: Game;
  beforeEach(() => {
    io = new FakeServer(); orch = new Orchestrator(io as any);
    const w = mkP('WITCH'); const a = mkP('A'); const b = mkP('B');
    io.sockets.sockets.set(w.socketId, new FakeSocket(w.socketId));
    io.sockets.sockets.set(a.socketId, new FakeSocket(a.socketId));
    io.sockets.sockets.set(b.socketId, new FakeSocket(b.socketId));
    game = {
      id:'G', state:'NIGHT_WITCH', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:3,
      players:[w,a,b], roles:{ WITCH:'WITCH', A:'VILLAGER', B:'VILLAGER' } as any,
      center: Array(2) as any,
      alive:new Set(['WITCH','A','B']), night:{ attacked:'A' }, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
      votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode:null
    };
    // Register the game in the orchestrator store so witchDecision can access it
    (orch as any).store.put(game);
  });

  it('cannot save if nothing to save', () => {
    game.night.attacked = undefined;
    expect(() => orch.witchDecision(game.id, 'WITCH', true)).toThrowError('nothing_to_save');
  });

  it('save once, then heal_already_used', () => {
    orch.witchDecision(game.id, 'WITCH', true);
    expect(game.night.saved).toBe('A');
    expect(game.inventory.witch.healUsed).toBe(true);
    expect(() => orch.witchDecision(game.id, 'WITCH', true)).toThrowError('heal_already_used');
  });

  it('cannot poison self, invalid targets rejected', () => {
    expect(() => orch.witchDecision(game.id, 'WITCH', false, 'WITCH')).toThrowError('cannot_poison_self');
    expect(() => orch.witchDecision(game.id, 'WITCH', false, 'Z')).toThrowError('invalid_poison_target');
  });
});
