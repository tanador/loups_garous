import { randomInt } from 'crypto';

export function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function id(): string {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join('');
  const digit = randomInt(10).toString();
  return letters + digit;
}
