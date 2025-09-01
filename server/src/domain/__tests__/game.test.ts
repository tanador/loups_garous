import { describe, it, expect, vi } from 'vitest';
import { createGame, addPlayer } from '../game.js';

describe('game', () => {
  it('updates timestamp when adding player', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const g = createGame('V1');
    vi.setSystemTime(2_000);
    addPlayer(g, { id: 'A', nickname: 'Alice', socketId: 'sA' });
    expect(g.updatedAt).toBe(2_000);
    vi.useRealTimers();
  });
});
