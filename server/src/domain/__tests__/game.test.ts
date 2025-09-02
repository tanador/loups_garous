import { describe, it, expect, vi } from 'vitest';
import { createGame, addPlayer } from '../game.js';
import { id } from '../utils.js';

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

  it('generates game id as 3 letters and a digit', () => {
    const gameId = id();
    expect(gameId).toMatch(/^[A-Z]{3}\d$/);
  });

  it('rejects duplicate nicknames', () => {
    const g = createGame('V1');
    addPlayer(g, { id: 'A', nickname: 'Alice', socketId: 'sA' });
    expect(() => addPlayer(g, { id: 'B', nickname: 'Alice', socketId: 'sB' })).toThrow('nickname_taken');
  });

  it('rejects duplicate nicknames case-insensitively', () => {
    const g = createGame('V1');
    addPlayer(g, { id: 'A', nickname: 'Alice', socketId: 'sA' });
    expect(() => addPlayer(g, { id: 'B', nickname: 'alice', socketId: 'sB' })).toThrow('nickname_taken');
  });

  it('rejects duplicate nicknames with extra spaces', () => {
    const g = createGame('V1');
    addPlayer(g, { id: 'A', nickname: 'Alice', socketId: 'sA' });
    expect(() => addPlayer(g, { id: 'B', nickname: ' Alice ', socketId: 'sB' })).toThrow('nickname_taken');
  });
});
