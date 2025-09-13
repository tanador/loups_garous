import { describe, it, expect } from 'vitest';
import { winner } from '../../domain/rules.js';
import type { Game } from '../../domain/types.js';

function makeGame(alive: string[], roles: Record<string, any>, lovers?: [string, string]): Game {
  const players = Object.keys(roles).map(id => ({ id, socketId: 's:'+id, isReady:true, connected:true, lastSeen:Date.now(), loverId: undefined as string | undefined }));
  if (lovers) {
    const [a,b] = lovers; const pa = players.find(p=>p.id===a)!; const pb = players.find(p=>p.id===b)!;
    pa.loverId = b; pb.loverId = a;
  }
  return {
    id:'G', state:'MORNING', createdAt:Date.now(), updatedAt:Date.now(), round:1, maxPlayers:players.length,
    players: players as any, roles: roles as any, alive: new Set(alive), night:{}, inventory:{ witch:{ healUsed:false, poisonUsed:false }},
    votes:{}, history:[], deadlines:{}, wolvesChoices:{}, morningAcks:new Set(), loversMode: lovers ? 'MIXED_CAMPS' : null
  } as any;
}

describe('winner()', () => {
  it('village wins when no wolves alive', () => {
    const g = makeGame(['A','B'], { A:'VILLAGER', B:'HUNTER' });
    expect(winner(g)).toBe('VILLAGE');
  });
  it('returns null at parity (1 wolf vs 1 villager)', () => {
    // À égalité numérique, la partie continue : aucune victoire immédiate.
    const g = makeGame(['W','X'], { W:'WOLF', X:'VILLAGER' });
    expect(winner(g)).toBeNull();
  });

  it('wolves win only when no villager remains', () => {
    // Le dernier villageois est mort : seuls les loups restent en vie -> victoire.
    const g = makeGame(['W'], { W:'WOLF' });
    expect(winner(g)).toBe('WOLVES');
  });
  it('mixed lovers win when only the two lovers remain', () => {
    const g = makeGame(['A','B'], { A:'WOLF', B:'VILLAGER' }, ['A','B']);
    expect(winner(g)).toBe('LOVERS');
  });
});

