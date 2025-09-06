import { describe, it, expect } from 'vitest';
import { createGame } from '../game.js';
import { setState, registerTransitions, canTransition } from '../fsm.js';

describe('fsm dynamic transitions', () => {
  it('allows registering extra phases', () => {
    const g = createGame(3);
    setState(g, 'ROLES');
    setState(g, 'NIGHT_WOLVES');
    setState(g, 'NIGHT_WITCH');
    setState(g, 'MORNING');

    registerTransitions({ MORNING: ['SPECIAL'], SPECIAL: ['VOTE'] });

    expect(canTransition(g, 'MORNING', 'SPECIAL')).toBe(true);

    setState(g, 'SPECIAL');
    expect(g.state).toBe('SPECIAL');

    setState(g, 'VOTE');
    expect(g.state).toBe('VOTE');
  });
});

