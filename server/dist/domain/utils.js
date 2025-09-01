import { randomInt, randomUUID } from 'crypto';
export function secureShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export function id() {
    return randomUUID();
}
//# sourceMappingURL=utils.js.map