/**
 * Utility helpers shared across domain modules.
 */
import { randomInt } from 'crypto';

/**
 * Return a shuffled copy of an array using the Fisher-Yates algorithm.
 *
 * We rely on `crypto.randomInt` instead of `Math.random` so tests and the real
 * game share the same uniform randomness guarantees.
 */
export function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a short, human friendly id used for game codes and players.
 *
 * Format example: `ABC1` (three uppercase letters followed by a digit).
 */
export function id(): string {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join('');
  const digit = randomInt(10).toString();
  return letters + digit;
}
