import { randomInt } from 'crypto';

/// Mélange un tableau en place à l'aide de l'algorithme de Fisher-Yates.
/// L'utilisation de `randomInt` garantit des tirages sûrs et uniformes.
export function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  // On parcourt le tableau à l'envers en échangeant chaque élément
  // avec un autre choisi aléatoirement avant lui.
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/// Génère un identifiant court pour les parties ou joueurs.
/// Exemple : `ABC1` (3 lettres majuscules suivies d'un chiffre).
export function id(): string {
  // Trois lettres majuscules aléatoires
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join('');
  // Un chiffre final pour limiter les collisions tout en restant lisible
  const digit = randomInt(10).toString();
  return letters + digit;
}
