import { Game } from '../domain/types.js';

export class GameStore {
  private games = new Map<string, Game>();

  put(game: Game) { this.games.set(game.id, game); }
  get(id: string) { return this.games.get(id); }
  del(id: string) { this.games.delete(id); }
  listLobby() {
    return Array.from(this.games.values())
      .filter(g => g.state === 'LOBBY' && g.players.length < 3)
      .map(g => ({ id: g.id, variant: g.variant, players: g.players.length, slots: 3 - g.players.length }));
  }
  all() { return Array.from(this.games.values()); }
  cleanupFinished(ttlMs = 5 * 60 * 1000) {
    const now = Date.now();
    for (const g of this.games.values()) {
      if (g.state === 'END' && now - g.updatedAt > ttlMs) this.games.delete(g.id);
    }
  }
}
